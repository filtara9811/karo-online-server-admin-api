import { z } from "zod";
import { getPool } from "./pg-client.js";

export type KycSubject = "vendor" | "customer";

const Aadhaar = z.object({
  check_type: z.literal("aadhaar"),
  document_number: z.string().regex(/^\d{12}$/, "Aadhaar must be 12 digits"),
  document_urls: z.array(z.string().max(1000)).min(2).max(2),
});
const Pan = z.object({
  check_type: z.literal("pan"),
  document_number: z.string().toUpperCase().pipe(z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Enter a valid PAN")),
  document_urls: z.array(z.string().max(1000)).max(1).optional(),
});
const Bank = z.object({
  check_type: z.literal("bank"),
  document_number: z.string().regex(/^\d{9,18}$/, "Enter a valid account number"),
  confirm_number: z.string().optional(),
  payload: z.object({
    holder: z.string().trim().min(2),
    ifsc: z.string().toUpperCase().pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC")),
    upi: z.string().trim().max(80).optional(),
  }),
});

const schemas = {
  vendor: z.discriminatedUnion("check_type", [
    z.object({
      check_type: z.literal("selfie"),
      document_urls: z.array(z.string().max(1000)).min(1).max(4),
      payload: z.object({ shop_name: z.string().trim().min(2), ceo_name: z.string().trim().min(2) }),
    }),
    Aadhaar,
    Pan,
    Bank,
  ]),
  customer: z.discriminatedUnion("check_type", [
    z.object({
      check_type: z.literal("selfie"),
      document_urls: z.array(z.string().max(1000)).min(1).max(4),
      payload: z.object({ name: z.string().trim().min(2) }),
    }),
    Aadhaar,
    Pan,
    Bank,
  ]),
};

/** Website stored the first vendor step as `selfie` and bank fields as holder/upi; older app builds sent shop/holder_name/upi_id. */
function normalizeKycBody(body: unknown) {
  const b = { ...((body ?? {}) as Record<string, unknown>) };
  if (b.check_type === "shop") b.check_type = "selfie";
  if (b.check_type === "bank" && b.payload && typeof b.payload === "object") {
    const p = { ...(b.payload as Record<string, unknown>) };
    p.holder ??= p.holder_name;
    p.upi ??= p.upi_id;
    delete p.holder_name;
    delete p.upi_id;
    b.payload = p;
  }
  return b;
}

export async function listKyc(userId: string, subject: KycSubject) {
  const { rows } = await getPool().query(
    `select distinct on (ct) *, ct as check_type from (
       select *, case when check_type = 'shop' then 'selfie' else check_type end as ct
         from public.kyc_verifications where user_id = $1 and subject_type = $2) k
      order by ct, created_at desc`,
    [userId, subject],
  );
  return rows.map(({ ct: _ct, ...r }) => r);
}

export type KycResult =
  | { ok: true; check: Record<string, unknown> }
  | { ok: false; status: number; code?: string; message: string; zod?: z.ZodError };

export async function submitKyc(userId: string, subject: KycSubject, body: unknown): Promise<KycResult> {
  const parsed = schemas[subject].safeParse(normalizeKycBody(body));
  if (!parsed.success) return { ok: false, status: 400, message: "Invalid KYC details", zod: parsed.error };
  const b = parsed.data as {
    check_type: string;
    document_number?: string;
    confirm_number?: string;
    document_urls?: string[];
    payload?: Record<string, unknown>;
  };
  const pool = getPool();
  if (b.check_type === "bank") {
    if (b.confirm_number != null && b.confirm_number !== b.document_number) {
      return { ok: false, status: 400, code: "ACCOUNT_MISMATCH", message: "Account numbers do not match" };
    }
    const { rows: done } = await pool.query(
      `select count(distinct case when check_type = 'shop' then 'selfie' else check_type end)::int as n
         from public.kyc_verifications
        where user_id = $1 and subject_type = $2 and status in ('submitted', 'approved')
          and check_type in ('selfie', 'shop', 'aadhaar', 'pan')`,
      [userId, subject],
    );
    if (Number(done[0]?.n ?? 0) < 3) {
      const first = subject === "vendor" ? "shop photo" : "your photo";
      return { ok: false, status: 409, code: "KYC_STEPS_PENDING", message: `Submit ${first}, Aadhaar and PAN before bank details` };
    }
  }
  await pool.query(
    `delete from public.kyc_verifications where user_id = $1 and subject_type = $2
        and check_type = any($3::text[]) and status <> 'approved'`,
    [userId, subject, b.check_type === "selfie" ? ["selfie", "shop"] : [b.check_type]],
  );
  const { rows } = await pool.query(
    `insert into public.kyc_verifications (user_id, subject_type, check_type, document_type, document_number, document_urls, request_payload, status)
     values ($1, $2, $3, $3, $4, $5, $6::jsonb, 'submitted') returning *`,
    [userId, subject, b.check_type, b.document_number ?? null, b.document_urls ?? [], JSON.stringify(b.payload ?? {})],
  );
  return { ok: true, check: rows[0] };
}
