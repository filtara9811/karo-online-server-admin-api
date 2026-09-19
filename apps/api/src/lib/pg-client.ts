import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import * as jose from "jose";
import { env } from "../config/env.js";

const scrypt = promisify(scryptCb);
const { Pool } = pg;

let pool: pg.Pool | null = null;

export function hasDatabase() {
  return Boolean(env.databaseUrl);
}

export function getPool() {
  if (!env.databaseUrl) throw new Error("DATABASE_URL missing");
  if (!pool) {
    const connectionString = env.databaseUrl.replace(/[?&]sslmode=[^&]+/i, "").replace(/[?&]uselibpqcompat=[^&]+/i, "");
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 8,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 20_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    pool.on("error", (err) => {
      console.error("[pg] idle connection dropped:", err.message);
    });
  }
  return pool;
}

function ident(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
}

function parseSelect(cols: string) {
  if (!cols || cols.trim() === "*") return "*";
  return cols
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => (c === "*" ? "*" : ident(c.replace(/"/g, ""))))
    .join(", ");
}

type Filter =
  | { kind: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "ilike"; col: string; value: unknown }
  | { kind: "in"; col: string; value: unknown[] }
  | { kind: "is"; col: string; value: unknown }
  | { kind: "or"; raw: string };

function applyFilters(filters: Filter[], start = 1) {
  const where: string[] = [];
  const params: unknown[] = [];
  let i = start;
  const op = (kind: string) =>
    ({ eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", ilike: "ilike" }[kind] ?? "=");
  for (const f of filters) {
    if (f.kind === "or") {
      const parts = f.raw.split(",").map((p) => p.trim()).filter(Boolean);
      const ors: string[] = [];
      for (const part of parts) {
        const m = part.match(/^([a-zA-Z0-9_]+)\.(eq|neq|ilike|is)\.(.*)$/);
        if (!m) continue;
        const [, col, kind, raw] = m;
        if (kind === "is" && raw === "null") {
          ors.push(`${ident(col)} is null`);
        } else {
          params.push(kind === "ilike" ? raw : raw);
          ors.push(`${ident(col)} ${op(kind)} $${i++}`);
        }
      }
      if (ors.length) where.push(`(${ors.join(" or ")})`);
      continue;
    }
    if (f.kind === "is") {
      where.push(f.value == null ? `${ident(f.col)} is null` : `${ident(f.col)} is not distinct from $${i++}`);
      if (f.value != null) params.push(f.value);
      continue;
    }
    if (f.kind === "in") {
      const vals = f.value ?? [];
      if (!vals.length) {
        where.push("false");
        continue;
      }
      const slots = vals.map((v) => {
        params.push(v);
        return `$${i++}`;
      });
      where.push(`${ident(f.col)} in (${slots.join(",")})`);
      continue;
    }
    params.push(f.value);
    where.push(`${ident(f.col)} ${op(f.kind)} $${i++}`);
  }
  return { sql: where.length ? ` where ${where.join(" and ")}` : "", params, next: i };
}

function jwtSecret() {
  return new TextEncoder().encode(env.jwtSecret);
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const buf = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${buf.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const buf = (await scrypt(password, Buffer.from(saltHex, "hex"), 32)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  return buf.length === expected.length && timingSafeEqual(buf, expected);
}

export async function signLocalJwt(user: { id: string; email: string; phone?: string | null; role?: string }) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  const token = await new jose.SignJWT({
    email: user.email,
    phone: user.phone ?? null,
    role: user.role ?? "authenticated",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(jwtSecret());
  return { token, exp };
}

export async function verifyLocalJwt(token: string) {
  const { payload } = await jose.jwtVerify(token, jwtSecret());
  const id = String(payload.sub ?? "");
  if (!id) throw new Error("Invalid token");
  return {
    id,
    email: typeof payload.email === "string" ? payload.email : null,
    phone: typeof payload.phone === "string" ? payload.phone : null,
    role: typeof payload.role === "string" ? payload.role : "authenticated",
    user_metadata: {},
  };
}

async function sessionFor(user: { id: string; email: string; phone?: string | null; role?: string; user_metadata?: unknown }) {
  const { token, exp } = await signLocalJwt(user);
  const authUser = {
    id: user.id,
    email: user.email,
    phone: user.phone ?? undefined,
    role: "authenticated",
    user_metadata: user.user_metadata ?? {},
    app_metadata: { provider: "email" },
  };
  return {
    session: {
      access_token: token,
      refresh_token: token,
      expires_in: 60 * 60 * 24 * 7,
      expires_at: exp,
      token_type: "bearer",
      user: authUser,
    },
    user: authUser,
  };
}

type QueryState = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  columns: string;
  count: boolean;
  filters: Filter[];
  orders: { col: string; asc: boolean }[];
  limit?: number;
  rangeFrom?: number;
  rangeTo?: number;
  payload?: unknown;
  onConflict?: string;
  single?: "maybe" | "one";
};

function makeQuery(table: string) {
  const state: QueryState = {
    table,
    op: "select",
    columns: "*",
    count: false,
    filters: [],
    orders: [],
  };

  const self: Record<string, unknown> = {};
  const chain = () => self;

  self.select = (cols = "*", opts?: { count?: string }) => {
    state.columns = typeof cols === "string" ? cols : "*";
    state.count = Boolean(opts?.count);
    // Supabase chains .select() after insert/update to mean RETURNING.
    // Do not flip a mutation back into a read.
    return chain();
  };
  self.eq = (col: string, value: unknown) => {
    state.filters.push({ kind: "eq", col, value });
    return chain();
  };
  self.neq = (col: string, value: unknown) => {
    state.filters.push({ kind: "neq", col, value });
    return chain();
  };
  self.gt = (col: string, value: unknown) => {
    state.filters.push({ kind: "gt", col, value });
    return chain();
  };
  self.gte = (col: string, value: unknown) => {
    state.filters.push({ kind: "gte", col, value });
    return chain();
  };
  self.lt = (col: string, value: unknown) => {
    state.filters.push({ kind: "lt", col, value });
    return chain();
  };
  self.lte = (col: string, value: unknown) => {
    state.filters.push({ kind: "lte", col, value });
    return chain();
  };
  self.ilike = (col: string, value: unknown) => {
    state.filters.push({ kind: "ilike", col, value });
    return chain();
  };
  self.in = (col: string, value: unknown[]) => {
    state.filters.push({ kind: "in", col, value });
    return chain();
  };
  self.is = (col: string, value: unknown) => {
    state.filters.push({ kind: "is", col, value });
    return chain();
  };
  self.or = (raw: string) => {
    state.filters.push({ kind: "or", raw });
    return chain();
  };
  self.order = (col: string, opts?: { ascending?: boolean }) => {
    state.orders.push({ col, asc: opts?.ascending !== false });
    return chain();
  };
  self.limit = (n: number) => {
    state.limit = n;
    return chain();
  };
  self.range = (from: number, to: number) => {
    state.rangeFrom = from;
    state.rangeTo = to;
    return chain();
  };
  self.maybeSingle = () => {
    state.single = "maybe";
    state.limit = 1;
    return chain();
  };
  self.single = () => {
    state.single = "one";
    state.limit = 1;
    return chain();
  };
  self.insert = (payload: unknown) => {
    state.op = "insert";
    state.payload = payload;
    return chain();
  };
  self.update = (payload: unknown) => {
    state.op = "update";
    state.payload = payload;
    return chain();
  };
  self.upsert = (payload: unknown, opts?: { onConflict?: string }) => {
    state.op = "upsert";
    state.payload = payload;
    state.onConflict = opts?.onConflict;
    return chain();
  };
  self.delete = () => {
    state.op = "delete";
    return chain();
  };

  const run = async () => execute(state);
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => run().then(resolve, reject);
  return self;
}

async function execute(state: QueryState) {
  try {
    const db = getPool();
    const table = `public.${ident(state.table)}`;
    if (state.op === "insert" || state.op === "upsert") {
      const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
      if (!rows.length) return { data: [], error: null, count: 0 };
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r as object)))];
      const params: unknown[] = [];
      const values = rows.map((row, ri) => {
        const rec = row as Record<string, unknown>;
        const slots = keys.map((k, ki) => {
          params.push(rec[k] ?? null);
          return `$${ri * keys.length + ki + 1}`;
        });
        return `(${slots.join(",")})`;
      });
      let sql = `insert into ${table} (${keys.map(ident).join(",")}) values ${values.join(",")}`;
      if (state.op === "upsert" && state.onConflict) {
        const conflict = state.onConflict.split(",").map((c) => ident(c.trim())).join(",");
        const sets = keys
          .filter((k) => k !== state.onConflict)
          .map((k) => `${ident(k)} = excluded.${ident(k)}`);
        sql += ` on conflict (${conflict}) do update set ${sets.join(",")}`;
      }
      sql += " returning *";
      const res = await db.query(sql, params);
      return { data: res.rows, error: null, count: res.rowCount ?? res.rows.length };
    }
    if (state.op === "update") {
      const rec = (state.payload ?? {}) as Record<string, unknown>;
      const keys = Object.keys(rec);
      const params: unknown[] = [];
      const sets = keys.map((k, i) => {
        params.push(rec[k]);
        return `${ident(k)} = $${i + 1}`;
      });
      const f = applyFilters(state.filters, params.length + 1);
      const sql = `update ${table} set ${sets.join(",")}${f.sql} returning *`;
      const res = await db.query(sql, [...params, ...f.params]);
      return { data: res.rows, error: null, count: res.rowCount ?? res.rows.length };
    }
    if (state.op === "delete") {
      const f = applyFilters(state.filters);
      const sql = `delete from ${table}${f.sql} returning *`;
      const res = await db.query(sql, f.params);
      return { data: res.rows, error: null, count: res.rowCount ?? res.rows.length };
    }

    const f = applyFilters(state.filters);
    let sql = `select ${parseSelect(state.columns)} from ${table}${f.sql}`;
    if (state.orders.length) {
      sql += ` order by ${state.orders.map((o) => `${ident(o.col)} ${o.asc ? "asc" : "desc"}`).join(", ")}`;
    }
    if (state.rangeFrom != null && state.rangeTo != null) {
      sql += ` limit ${state.rangeTo - state.rangeFrom + 1} offset ${state.rangeFrom}`;
    } else if (state.limit != null) {
      sql += ` limit ${state.limit}`;
    }
    const res = await db.query(sql, f.params);
    let count = res.rowCount ?? res.rows.length;
    if (state.count) {
      const c = await db.query(`select count(*)::int as n from ${table}${f.sql}`, f.params);
      count = Number(c.rows[0]?.n ?? 0);
    }
    if (state.single === "maybe") return { data: res.rows[0] ?? null, error: null, count };
    if (state.single === "one") {
      if (!res.rows[0]) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" }, count };
      return { data: res.rows[0], error: null, count };
    }
    return { data: res.rows, error: null, count };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { data: null, error: { message }, count: 0 };
  }
}

export function createPgClient() {
  return {
    from: (table: string) => makeQuery(table),
    rpc: async (name: string) => {
      try {
        const res = await getPool().query(`select public.${ident(name)}() as data`);
        return { data: res.rows[0]?.data ?? null, error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { data: null, error: { message } };
      }
    },
    auth: {
      async getUser(token?: string) {
        if (!token) return { data: { user: null }, error: { message: "No token" } };
        try {
          const user = await verifyLocalJwt(token);
          return { data: { user }, error: null };
        } catch (err) {
          return { data: { user: null }, error: { message: err instanceof Error ? err.message : "Invalid token" } };
        }
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const res = await getPool().query(
          `select id, email, phone, password_hash, user_metadata from public.local_users where lower(email) = lower($1) limit 1`,
          [email],
        );
        const row = res.rows[0];
        if (!row || !(await verifyPassword(password, row.password_hash))) {
          return { data: { session: null, user: null }, error: { message: "Invalid login credentials" } };
        }
        const signed = await sessionFor({
          id: row.id,
          email: row.email,
          phone: row.phone,
          user_metadata: row.user_metadata,
        });
        return { data: signed, error: null };
      },
      admin: {
        async listUsers(_opts?: { page?: number; perPage?: number }) {
          const res = await getPool().query(
            `select id, email, phone, user_metadata, created_at from public.local_users order by created_at desc limit 200`,
          );
          return { data: { users: res.rows }, error: null };
        },
        async createUser(input: {
          id?: string;
          email: string;
          password: string;
          email_confirm?: boolean;
          user_metadata?: Record<string, unknown>;
        }) {
          const id = input.id ?? cryptoRandomUuid();
          const password_hash = await hashPassword(input.password);
          try {
            const res = await getPool().query(
              `insert into public.local_users (id, email, password_hash, phone, user_metadata)
               values ($1, $2, $3, $4, $5::jsonb)
               returning id, email, phone, user_metadata`,
              [
                id,
                input.email,
                password_hash,
                (input.user_metadata?.phone as string) ?? null,
                JSON.stringify(input.user_metadata ?? {}),
              ],
            );
            return { data: { user: res.rows[0] }, error: null };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (/duplicate|unique/i.test(message)) {
              return { data: { user: null }, error: { message: "User already registered" } };
            }
            return { data: { user: null }, error: { message } };
          }
        },
        async updateUserById(
          id: string,
          input: { email?: string; password?: string; user_metadata?: Record<string, unknown> },
        ) {
          const sets: string[] = [];
          const params: unknown[] = [];
          let i = 1;
          if (input.email) {
            sets.push(`email = $${i++}`);
            params.push(input.email);
          }
          if (input.password) {
            sets.push(`password_hash = $${i++}`);
            params.push(await hashPassword(input.password));
          }
          if (input.user_metadata) {
            sets.push(`user_metadata = $${i++}::jsonb`);
            params.push(JSON.stringify(input.user_metadata));
            if (input.user_metadata.phone) {
              sets.push(`phone = $${i++}`);
              params.push(input.user_metadata.phone);
            }
          }
          if (!sets.length) {
            const found = await getPool().query(`select id from public.local_users where id = $1`, [id]);
            return found.rowCount
              ? { data: { user: found.rows[0] }, error: null }
              : { data: { user: null }, error: { message: "User not found" } };
          }
          params.push(id);
          const res = await getPool().query(
            `update public.local_users set ${sets.join(", ")} where id = $${i} returning id, email, phone, user_metadata`,
            params,
          );
          if (!res.rowCount) return { data: { user: null }, error: { message: "User not found" } };
          return { data: { user: res.rows[0] }, error: null };
        },
      },
    },
  };
}

function cryptoRandomUuid() {
  const hex = randomBytes(16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function fingerprint(_unused?: unknown) {
  return createHash("sha256").update(env.databaseUrl || "none").digest("hex").slice(0, 8);
}
