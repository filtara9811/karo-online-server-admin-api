import { getPool } from "./pg-client.js";

const q = (sql: string, params: unknown[] = []) => getPool().query(sql, params);

export function last10(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export async function findUserByPhone(phone: string) {
  const tail = last10(phone);
  if (tail.length !== 10) return null;
  const { rows } = await q(
    `select id, phone, email, coalesce(user_metadata->>'name', user_metadata->>'full_name') as name
       from public.local_users
      where right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1
      limit 1`,
    [tail],
  );
  return rows[0] as { id: string; phone: string | null; email: string | null; name: string | null } | undefined;
}

async function nextCode() {
  const { rows } = await q(
    `select coalesce(max(nullif(regexp_replace(coalesce(employee_code, ''), '\\D', '', 'g'), '')::int), 0) + 1 as n
       from public.staff_profiles`,
  );
  const n = Number(rows[0]?.n ?? 1);
  return `ST${String(n).padStart(3, "0")}`;
}

export async function grantStaff(input: {
  phone: string;
  name?: string;
  zone?: string;
  roleLabel?: string;
  approvedBy?: string | null;
}) {
  const user = await findUserByPhone(input.phone);
  if (!user) return { ok: false as const, error: "No Karo account uses this mobile. They must log in once first." };
  const name = (input.name || user.name || "Staff").trim();
  const code = await nextCode();
  await q(
    `insert into public.user_roles (user_id, role)
     select $1, 'staff'
      where not exists (select 1 from public.user_roles where user_id = $1 and role = 'staff')`,
    [user.id],
  );
  const { rows } = await q(
    `insert into public.staff_profiles
       (user_id, name, phone, email, zone, role_label, staff_status, employee_code, payout_model, joined_at, approved_by, approved_at)
     values ($1, $2, $3, $4, $5, $6, 'active', $7, 'per_task', now(), $8, now())
     on conflict (user_id) do update set
       name = excluded.name,
       phone = excluded.phone,
       email = coalesce(excluded.email, public.staff_profiles.email),
       zone = coalesce(excluded.zone, public.staff_profiles.zone),
       role_label = coalesce(excluded.role_label, public.staff_profiles.role_label),
       staff_status = 'active',
       employee_code = coalesce(public.staff_profiles.employee_code, excluded.employee_code),
       approved_by = excluded.approved_by,
       approved_at = now()
     returning *`,
    [user.id, name, user.phone ?? input.phone, user.email, input.zone ?? null, input.roleLabel ?? "Field Sales", code, input.approvedBy ?? null],
  );
  const profile = rows[0];
  await q(`insert into public.staff_wallets (staff_id) values ($1) on conflict (staff_id) do nothing`, [profile.id]);
  return { ok: true as const, staff: profile };
}

async function profileByUser(userId: string) {
  const { rows } = await q(`select * from public.staff_profiles where user_id = $1 limit 1`, [userId]);
  return rows[0] as Record<string, unknown> | undefined;
}

export async function requireActiveStaff(userId: string) {
  const profile = await profileByUser(userId);
  if (!profile || profile.staff_status === "suspended") return null;
  return profile;
}

export async function creditStaff(staffId: string, amount: number, kind: string, note: string) {
  if (!(amount > 0)) return;
  await q(`insert into public.staff_wallets (staff_id, balance_inr, lifetime_earned) values ($1, 0, 0) on conflict (staff_id) do nothing`, [staffId]);
  await q(
    `update public.staff_wallets
        set balance_inr = coalesce(balance_inr, 0) + $2,
            lifetime_earned = coalesce(lifetime_earned, 0) + $2,
            updated_at = now()
      where staff_id = $1`,
    [staffId, amount],
  );
  await q(
    `insert into public.staff_wallet_ledger (staff_id, amount_inr, kind, note) values ($1, $2, $3, $4)`,
    [staffId, amount, kind, note],
  );
}

export async function staffHome(userId: string) {
  const profile = await profileByUser(userId);
  if (!profile) return { staff: null };
  const sid = profile.id as string;
  const [wallet, ledger, tasks, onboarded, counts, withdrawals, tickets, stock] = await Promise.all([
    q(`select * from public.staff_wallets where staff_id = $1`, [sid]),
    q(
      `select id, amount_inr, kind, note, created_at from public.staff_wallet_ledger
        where staff_id = $1 order by created_at desc limit 40`,
      [sid],
    ),
    q(
      `select id, title, description, task_type, status, amount_inr, due_label, admin_note, shop_name, qr_codes, result_note, target_count, done_count, assigned_at, submitted_at
         from public.staff_tasks where staff_id = $1 order by assigned_at desc limit 50`,
      [sid],
    ),
    q(
      `select o.id, o.business_name, o.owner_name, o.phone, o.category, o.address, o.lat, o.lng, o.source, o.status,
              o.otp_verified, o.created_at, o.photo_out_url, o.photo_in_url, o.kyc_aadhaar_url, o.kyc_pan_url, o.kyc_gst_url,
              coalesce(v.staff_bonus_paid, o.bonus_paid, false) as bonus_paid
         from public.staff_onboardings o
         left join public.vendors v on v.user_id = o.vendor_user_id
        where o.staff_id = $1
        order by o.created_at desc limit 50`,
      [sid],
    ),
    q(
      `select
         (select count(*)::int from public.staff_onboardings where staff_id = $1 and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date) as vendors,
         (select count(*)::int from public.staff_tasks where staff_id = $1 and task_type = 'standee' and status in ('submitted','approved') and (coalesce(submitted_at, assigned_at) at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date) as standees,
         (select count(*)::int from public.staff_tasks where staff_id = $1 and task_type = 'kyc' and status in ('submitted','approved') and (coalesce(submitted_at, assigned_at) at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date) as kyc`,
      [sid],
    ),
    q(
      `select id, amount_inr, upi_id, status, created_at, reviewed_at
         from public.staff_withdrawal_requests where staff_id = $1 order by created_at desc limit 20`,
      [sid],
    ),
    q(
      `select id, title, body, contact_phone, status, created_at
         from public.staff_tickets where staff_id = $1 and status = 'open' order by created_at desc limit 30`,
      [sid],
    ),
    q(`select count(*)::int as n from public.staff_qr_stock where staff_id = $1 and mapped_at is null`, [sid]),
  ]);
  return {
    staff: profile,
    wallet: wallet.rows[0] ?? { balance_inr: 0, lifetime_earned: 0, lifetime_withdrawn: 0 },
    ledger: ledger.rows,
    tasks: tasks.rows,
    onboarded: onboarded.rows,
    withdrawals: withdrawals.rows,
    tickets: tickets.rows,
    qr_stock: Number(stock.rows[0]?.n ?? 0),
    counts: counts.rows[0] ?? { vendors: 0, standees: 0, kyc: 0 },
    targets: { vendors: 8, standees: 10, kyc: 6 },
    rates: { vendor: 200, standee: 50, kyc: 50 },
    join_link: `https://karoonline.in/v/join?st=${profile.employee_code ?? ""}`,
  };
}

export async function setDuty(userId: string, on: boolean) {
  const { rows } = await q(
    `update public.staff_profiles
        set on_duty = $2,
            duty_started_at = case when $2 then now() else duty_started_at end
      where user_id = $1 and coalesce(staff_status, 'active') <> 'suspended'
      returning *`,
    [userId, on],
  );
  return rows[0] ?? null;
}

export async function createOnboarding(
  userId: string,
  body: {
    business_name: string;
    owner_name?: string;
    phone: string;
    category?: string;
    address?: string;
    lat?: number;
    lng?: number;
    source: "manual" | "ocr" | "link";
    photo_out_url?: string;
    photo_in_url?: string;
    kyc_aadhaar_url?: string;
    kyc_pan_url?: string;
    kyc_gst_url?: string;
    otp_verified?: boolean;
    confirm_similar?: boolean;
  },
) {
  const staff = await requireActiveStaff(userId);
  if (!staff) return { ok: false as const, error: "Staff profile is not active" };
  const phone = last10(body.phone);
  if (phone.length !== 10) return { ok: false as const, error: "Enter a 10-digit mobile number" };
  const dup = await q(
    `select id from public.staff_onboardings
      where staff_id = $1 and phone = $2 and status <> 'live' limit 1`,
    [staff.id, phone],
  );
  if (dup.rows[0]) return { ok: false as const, error: "This mobile is already in your onboard list" };
  if (!body.confirm_similar) {
    const similar = await findSimilarShop(staff.id as string, body.business_name);
    if (similar) return { ok: false as const, error: `Milti-julti dukaan: ${similar}. Alag dukaan hai to dobara jodein.` };
  }
  const existing = await findUserByPhone(phone);
  const status = body.source === "link" && !existing ? "link_sent" : "pending";
  const { rows } = await q(
    `insert into public.staff_onboardings
       (staff_id, business_name, owner_name, phone, category, address, lat, lng, source, status, vendor_user_id,
        photo_out_url, photo_in_url, kyc_aadhaar_url, kyc_pan_url, kyc_gst_url, otp_verified)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     returning *`,
    [
      staff.id,
      body.business_name.trim(),
      body.owner_name?.trim() || null,
      phone,
      body.category ?? null,
      body.address ?? null,
      body.lat ?? null,
      body.lng ?? null,
      body.source,
      status,
      existing?.id ?? null,
      body.photo_out_url ?? null,
      body.photo_in_url ?? null,
      body.kyc_aadhaar_url ?? null,
      body.kyc_pan_url ?? null,
      body.kyc_gst_url ?? null,
      body.otp_verified === true,
    ],
  );
  if (existing) {
    await q(
      `update public.vendors
          set onboarded_by_staff_id = coalesce(onboarded_by_staff_id, $2), updated_at = now()
        where user_id = $1`,
      [existing.id, staff.id],
    );
  }
  await q(
    `update public.staff_tasks set done_count = coalesce(done_count, 0) + 1
      where id = (
        select id from public.staff_tasks
         where staff_id = $1 and task_type = 'onboard' and status = 'assigned'
           and coalesce(target_count, 0) > coalesce(done_count, 0)
         order by assigned_at asc limit 1
      )`,
    [staff.id],
  );
  return { ok: true as const, onboarding: rows[0] };
}

function shopKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\b(the|shop|store|dukaan|wala|wale|and|aur|ki|ka|di)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

function namesAreSimilar(a: string, b: string) {
  if (a.length < 4 || b.length < 4 || a === b) return a.length >= 4 && a === b;
  const head = Math.max(5, Math.min(a.length, b.length) - 2);
  return a.slice(0, head) === b.slice(0, head);
}

async function findSimilarShop(staffId: string, name: string) {
  const key = shopKey(name);
  if (key.length < 4) return null;
  const word = (name.trim().split(/\s+/).find((part) => shopKey(part).length >= 4) ?? name.trim()).replace(/[%_]/g, "");
  const { rows } = await q(
    `select business_name from public.staff_onboardings where staff_id = $1
     union all
     select business_name from public.vendors where business_name ilike $2
     limit 80`,
    [staffId, `%${word}%`],
  );
  for (const row of rows) {
    const other = String(row.business_name ?? "");
    if (namesAreSimilar(key, shopKey(other))) return other;
  }
  return null;
}

export async function attributeVendorJoin(vendorUserId: string, whatsapp: string, staffCode?: string | null) {
  if (staffCode) {
    await q(
      `update public.vendors v
          set onboarded_by_staff_id = p.id
         from public.staff_profiles p
        where v.user_id = $1
          and v.onboarded_by_staff_id is null
          and p.employee_code = $2
          and coalesce(p.staff_status, 'active') = 'active'`,
      [vendorUserId, staffCode.trim()],
    );
  }
  const tail = last10(whatsapp);
  if (tail.length !== 10) return;
  await q(
    `update public.vendors v
        set onboarded_by_staff_id = coalesce(v.onboarded_by_staff_id, o.staff_id)
       from public.staff_onboardings o
      where v.user_id = $1
        and v.onboarded_by_staff_id is null
        and right(regexp_replace(o.phone, '\\D', '', 'g'), 10) = $2`,
    [vendorUserId, tail],
  );
  await q(
    `update public.staff_onboardings o
        set vendor_user_id = $1,
            status = case when o.status = 'link_sent' then 'pending' else o.status end
      where o.vendor_user_id is null
        and right(regexp_replace(o.phone, '\\D', '', 'g'), 10) = $2`,
    [vendorUserId, tail],
  );
}

export async function payVendorStaffBonus(vendorUserId: string) {
  const { rows } = await q(
    `update public.vendors
        set staff_bonus_paid = true, updated_at = now()
      where user_id = $1
        and onboarded_by_staff_id is not null
        and coalesce(staff_bonus_paid, false) = false
      returning onboarded_by_staff_id, business_name`,
    [vendorUserId],
  );
  const row = rows[0];
  if (!row) return;
  await creditStaff(row.onboarded_by_staff_id, 200, "vendor_approve", `Vendor approved · ${row.business_name ?? "shop"}`);
  await q(
    `update public.staff_onboardings set status = 'live', bonus_paid = true where vendor_user_id = $1 and status <> 'live'`,
    [vendorUserId],
  );
}

export async function addOnboardingKyc(
  userId: string,
  onboardingId: string,
  photos: { aadhaar?: string; pan?: string; gst?: string },
) {
  const staff = await requireActiveStaff(userId);
  if (!staff) return { ok: false as const, error: "Staff profile is not active" };
  if (!photos.aadhaar && !photos.pan && !photos.gst) return { ok: false as const, error: "Kam se kam ek KYC photo chahiye" };
  const { rows } = await q(
    `update public.staff_onboardings
        set kyc_aadhaar_url = coalesce($3, kyc_aadhaar_url),
            kyc_pan_url = coalesce($4, kyc_pan_url),
            kyc_gst_url = coalesce($5, kyc_gst_url)
      where id = $1 and staff_id = $2 and status <> 'live'
      returning id`,
    [onboardingId, staff.id, photos.aadhaar ?? null, photos.pan ?? null, photos.gst ?? null],
  );
  if (!rows[0]) return { ok: false as const, error: "Shop not found" };
  return { ok: true as const };
}

export function readQrCode(raw: string): string {
  const text = raw.trim();
  const tagged = text.match(/KO-QR-[0-9A-Z]{3,12}/i);
  if (tagged) return tagged[0].toUpperCase();
  try {
    const last = decodeURIComponent(new URL(text).pathname.split("/").filter(Boolean).pop() ?? "");
    if (/^[A-Za-z0-9_-]{4,40}$/.test(last)) return last.toUpperCase();
  } catch {
    /* typed codes are not URLs */
  }
  const plain = text.replace(/\s+/g, "");
  if (/^[A-Za-z0-9_-]{4,40}$/.test(plain)) return plain.toUpperCase();
  return "";
}

export async function mapStaffQr(userId: string, taskId: string, raw: string) {
  const staff = await requireActiveStaff(userId);
  if (!staff) return { ok: false as const, error: "Staff profile is not active" };
  const code = readQrCode(raw);
  if (!code) return { ok: false as const, error: "Ye Karo QR nahi lagta. Code KO-QR- jaisa hona chahiye." };
  const task = await q(`select id, shop_name, title, task_type from public.staff_tasks where id = $1 and staff_id = $2`, [taskId, staff.id]);
  const row = task.rows[0];
  if (!row) return { ok: false as const, error: "Task not found" };
  if (row.task_type !== "standee") return { ok: false as const, error: "QR mapping is only for a standee task" };
  const shop = String(row.shop_name || row.title || "dukaan");
  const existing = await q(`select code, shop_name, task_id from public.staff_qr_codes where code = $1`, [code]);
  const prev = existing.rows[0];
  if (prev) {
    if (String(prev.task_id) === taskId) return { ok: false as const, error: `${code} isi dukaan ke liye pehle scan ho chuka hai` };
    return { ok: false as const, error: `${code} pehle se ${prev.shop_name || "dusri dukaan"} se juda hai. Ye standee mat lagaiye.` };
  }
  const stock = await q(`select staff_id, mapped_at from public.staff_qr_stock where code = $1`, [code]);
  const mine = stock.rows[0];
  if (!mine || String(mine.staff_id) !== String(staff.id)) {
    return { ok: false as const, error: `${code} aapke blank stock me nahi hai. Admin se standee maangein.` };
  }
  if (mine.mapped_at) return { ok: false as const, error: `${code} pehle se use ho chuka hai` };
  await q(
    `insert into public.staff_qr_codes (code, shop_name, staff_id, task_id) values ($1,$2,$3,$4)`,
    [code, shop, staff.id, taskId],
  );
  await q(`update public.staff_qr_stock set mapped_at = now(), shop_name = $2, task_id = $3 where code = $1`, [code, shop, taskId]);
  await q(
    `update public.staff_tasks
        set qr_codes = (select array_agg(distinct c) from unnest(coalesce(qr_codes, '{}') || array[$2]::text[]) c)
      where id = $1`,
    [taskId, code],
  );
  return { ok: true as const, code, shop_name: shop };
}

export async function testStaffQr(userId: string, taskId: string, raw: string) {
  const staff = await requireActiveStaff(userId);
  if (!staff) return { ok: false as const, error: "Staff profile is not active" };
  const code = readQrCode(raw);
  if (!code) return { ok: false as const, error: "Ye Karo QR nahi lagta" };
  const task = await q(`select shop_name, title, qr_codes from public.staff_tasks where id = $1 and staff_id = $2`, [taskId, staff.id]);
  const row = task.rows[0];
  if (!row) return { ok: false as const, error: "Task not found" };
  const codes: string[] = row.qr_codes ?? [];
  if (!codes.includes(code)) return { ok: false as const, error: `${code} is dukaan par map nahi hua` };
  return { ok: true as const, code, shop_name: String(row.shop_name || row.title || "dukaan") };
}

export async function issueQrStock(staffId: string, count: number) {
  const { randomBytes } = await import("node:crypto");
  const made: string[] = [];
  let guard = 0;
  while (made.length < count && guard < count * 8) {
    guard += 1;
    const code = `KO-QR-${randomBytes(2).toString("hex").toUpperCase()}`;
    const ins = await q(
      `insert into public.staff_qr_stock (code, staff_id) values ($1, $2) on conflict (code) do nothing returning code`,
      [code, staffId],
    );
    if (ins.rows[0]) made.push(ins.rows[0].code);
  }
  return made;
}

export async function requestQrStock(userId: string) {
  const staff = await requireActiveStaff(userId);
  if (!staff) return { ok: false as const, error: "Staff profile is not active" };
  await q(`insert into public.staff_qr_requests (staff_id) values ($1)`, [staff.id]);
  return { ok: true as const };
}

export async function listQrRequests() {
  const { rows } = await q(
    `select r.id, r.status, r.created_at, p.name as staff_name, p.employee_code, r.staff_id
       from public.staff_qr_requests r
       left join public.staff_profiles p on p.id = r.staff_id
      where r.status = 'pending' order by r.created_at desc limit 30`,
  );
  return rows;
}

export async function payStaffFirstOrderBonus(vendorUserId: string) {
  const { rows } = await q(
    `update public.vendors v
        set staff_first_order_paid = true, updated_at = now()
      where v.user_id = $1
        and v.onboarded_by_staff_id is not null
        and coalesce(v.staff_first_order_paid, false) = false
        and (
          exists (
            select 1 from public.staff_onboardings o
             where o.vendor_user_id = v.user_id and o.created_at > now() - interval '7 days'
          )
          or (
            v.created_at > now() - interval '7 days'
            and not exists (select 1 from public.staff_onboardings o where o.vendor_user_id = v.user_id)
          )
        )
      returning onboarded_by_staff_id, business_name`,
    [vendorUserId],
  );
  const row = rows[0];
  if (!row) return;
  await creditStaff(row.onboarded_by_staff_id, 100, "first_order", `Pehla order 7 din me · ${row.business_name ?? "shop"}`);
}

async function pingStaff(staffId: string, title: string, body: string) {
  try {
    const { rows } = await q(`select user_id from public.staff_profiles where id = $1`, [staffId]);
    const userId = rows[0]?.user_id;
    if (!userId) return;
    const { pushToUser } = await import("./push.js");
    await pushToUser({
      userId: String(userId),
      title,
      body,
      actionUrl: "/staff",
      extraData: { kind: "staff" },
    });
  } catch {
    /* the task is still on the phone the next time staff opens the app */
  }
}

export async function taskWork(userId: string, taskId: string) {
  const staff = await requireActiveStaff(userId);
  if (!staff) return { ok: false as const, error: "Staff profile is not active" };
  const task = await q(`select id, task_type from public.staff_tasks where id = $1 and staff_id = $2`, [taskId, staff.id]);
  if (!task.rows[0]) return { ok: false as const, error: "Task not found" };
  const items = await q(
    `select id, kind, title, detail, parent_name, status, created_at from public.staff_desk_items where task_id = $1 order by created_at desc limit 40`,
    [taskId],
  );
  const reviews = task.rows[0].task_type === "review"
    ? await q(
        `select r.id, r.stars, r.comment, v.business_name
           from public.vendor_reviews r
           join public.vendors v on v.user_id = r.vendor_id
          where coalesce(r.hidden, false) = false
            and not exists (
              select 1 from public.staff_desk_items d where d.ref_id = r.id and d.kind = 'review' and d.status <> 'open'
            )
          order by r.created_at desc limit 20`,
      )
    : { rows: [] };
  return { ok: true as const, items: items.rows, reviews: reviews.rows };
}

export async function addDeskItem(userId: string, taskId: string, input: { title: string; parentName?: string; detail?: string; status?: string }) {
  const staff = await requireActiveStaff(userId);
  if (!staff) return { ok: false as const, error: "Staff profile is not active" };
  const task = await q(`select id, task_type, target_count, done_count from public.staff_tasks where id = $1 and staff_id = $2 and status = 'assigned'`, [taskId, staff.id]);
  const row = task.rows[0];
  if (!row) return { ok: false as const, error: "Task not found" };
  const kind = String(row.task_type);
  if (!["category", "care"].includes(kind)) return { ok: false as const, error: "Ye kaam list me nahi judta" };
  const title = input.title.trim();
  if (title.length < 2) return { ok: false as const, error: "Naam likhein" };
  if (kind === "category") {
    const dup = await q(
      `select id from public.staff_desk_items where task_id = $1 and lower(title) = lower($2) limit 1`,
      [taskId, title],
    );
    if (dup.rows[0]) return { ok: false as const, error: `"${title}" pehle se hai — duplicate nahi judi` };
  }
  await q(
    `insert into public.staff_desk_items (task_id, staff_id, kind, title, detail, parent_name, status)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [taskId, staff.id, kind, title, input.detail?.trim() || null, input.parentName?.trim() || null, input.status || (kind === "category" ? "pending" : "done")],
  );
  await q(`update public.staff_tasks set done_count = coalesce(done_count, 0) + 1 where id = $1`, [taskId]);
  return { ok: true as const };
}

export async function decideReview(userId: string, taskId: string, reviewId: string, hide: boolean) {
  const staff = await requireActiveStaff(userId);
  if (!staff) return { ok: false as const, error: "Staff profile is not active" };
  const task = await q(`select id from public.staff_tasks where id = $1 and staff_id = $2 and task_type = 'review' and status = 'assigned'`, [taskId, staff.id]);
  if (!task.rows[0]) return { ok: false as const, error: "Task not found" };
  const review = await q(`select id, comment from public.vendor_reviews where id = $1`, [reviewId]);
  if (!review.rows[0]) return { ok: false as const, error: "Review not found" };
  await q(
    `insert into public.staff_desk_items (task_id, staff_id, kind, title, status, ref_id) values ($1,$2,'review',$3,$4,$5)`,
    [taskId, staff.id, String(review.rows[0].comment ?? "Review").slice(0, 160), hide ? "hidden" : "approved", reviewId],
  );
  if (hide) await q(`update public.vendor_reviews set hidden = true, updated_at = now() where id = $1`, [reviewId]);
  await q(`update public.staff_tasks set done_count = coalesce(done_count, 0) + 1 where id = $1`, [taskId]);
  return { ok: true as const };
}

export async function listPendingDesk() {
  const { rows } = await q(
    `select d.id, d.title, d.parent_name, d.kind, d.created_at, p.name as staff_name
       from public.staff_desk_items d
       left join public.staff_profiles p on p.id = d.staff_id
      where d.kind = 'category' and d.status = 'pending'
      order by d.created_at desc limit 40`,
  );
  return rows;
}

export async function approveDeskItem(id: string) {
  const { rows } = await q(`update public.staff_desk_items set status = 'approved' where id = $1 and status = 'pending' returning id`, [id]);
  if (!rows[0]) return { ok: false as const, error: "Item is not pending" };
  return { ok: true as const };
}

export async function createStaffTicket(input: { staffId: string; title: string; body?: string; contactPhone?: string }) {
  const { rows } = await q(
    `insert into public.staff_tickets (staff_id, title, body, contact_phone) values ($1,$2,$3,$4) returning *`,
    [input.staffId, input.title.trim(), input.body?.trim() || null, input.contactPhone?.trim() || null],
  );
  void pingStaff(input.staffId, "Naya ticket", input.title.trim());
  return rows[0];
}

export async function resolveStaffTicket(userId: string, ticketId: string, note?: string) {
  const staff = await requireActiveStaff(userId);
  if (!staff) return { ok: false as const, error: "Staff profile is not active" };
  const { rows } = await q(
    `update public.staff_tickets
        set status = 'resolved', result_note = $3, resolved_at = now()
      where id = $1 and staff_id = $2 and status = 'open'
      returning id`,
    [ticketId, staff.id, note?.trim() || null],
  );
  if (!rows[0]) return { ok: false as const, error: "Ticket not found" };
  return { ok: true as const };
}

export async function assignTask(input: {
  staffId: string;
  title: string;
  taskType: string;
  amountInr: number;
  note?: string;
  dueLabel?: string;
  shopName?: string;
  assignedBy?: string | null;
  targetCount?: number;
}) {
  const { rows } = await q(
    `insert into public.staff_tasks
       (staff_id, title, description, task_type, amount_inr, due_label, admin_note, shop_name, status, assigned_by, target_count)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'assigned',$9,$10)
     returning *`,
    [
      input.staffId,
      input.title,
      input.note ?? null,
      input.taskType,
      input.amountInr,
      input.dueLabel ?? "Aaj",
      input.note ?? null,
      input.shopName ?? null,
      input.assignedBy ?? null,
      input.targetCount ?? 0,
    ],
  );
  void pingStaff(input.staffId, "Naya kaam", input.title);
  return rows[0];
}

export async function reviewTask(taskId: string, approved: boolean) {
  const { rows } = await q(`select * from public.staff_tasks where id = $1`, [taskId]);
  const task = rows[0];
  if (!task) return { ok: false as const, error: "Task not found" };
  if (approved) {
    await q(
      `update public.staff_tasks set status = 'approved', submitted_at = coalesce(submitted_at, now()) where id = $1`,
      [taskId],
    );
    if (!task.bonus_paid && Number(task.amount_inr) > 0) {
      await creditStaff(task.staff_id, Number(task.amount_inr), task.task_type || "task", task.title || "Task approved");
      await q(`update public.staff_tasks set bonus_paid = true where id = $1`, [taskId]);
    }
  } else {
    await q(`update public.staff_tasks set status = 'rejected' where id = $1`, [taskId]);
  }
  return { ok: true as const };
}

export async function listStaffWithdrawals() {
  const { rows } = await q(
    `select w.*, p.name as staff_name, p.employee_code, p.phone
       from public.staff_withdrawal_requests w
       left join public.staff_profiles p on p.id = w.staff_id
      order by w.created_at desc
      limit 50`,
  );
  return rows;
}

export async function decideWithdrawal(id: string, action: "paid" | "rejected", reviewer?: string | null) {
  const { rows } = await q(`select * from public.staff_withdrawal_requests where id = $1`, [id]);
  const row = rows[0];
  if (!row || row.status !== "pending") return { ok: false as const, error: "Request is not pending" };
  if (action === "rejected") {
    await q(
      `update public.staff_withdrawal_requests set status = 'rejected', reviewed_at = now(), reviewed_by = $2 where id = $1`,
      [id, reviewer ?? null],
    );
    return { ok: true as const };
  }
  const amount = Number(row.amount_inr);
  const upd = await q(
    `update public.staff_wallets
        set balance_inr = coalesce(balance_inr, 0) - $2,
            lifetime_withdrawn = coalesce(lifetime_withdrawn, 0) + $2,
            updated_at = now()
      where staff_id = $1 and coalesce(balance_inr, 0) >= $2
      returning staff_id`,
    [row.staff_id, amount],
  );
  if (!upd.rows[0]) return { ok: false as const, error: "Staff wallet does not have this balance" };
  await q(
    `insert into public.staff_wallet_ledger (staff_id, amount_inr, kind, note) values ($1, $2, 'withdrawal', $3)`,
    [row.staff_id, amount, `Withdrawal to ${row.upi_id}`],
  );
  await q(
    `update public.staff_withdrawal_requests set status = 'paid', reviewed_at = now(), reviewed_by = $2 where id = $1`,
    [id, reviewer ?? null],
  );
  return { ok: true as const };
}
