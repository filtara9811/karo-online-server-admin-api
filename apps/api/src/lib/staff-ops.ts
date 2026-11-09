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
  const [wallet, ledger, tasks, onboarded, counts] = await Promise.all([
    q(`select * from public.staff_wallets where staff_id = $1`, [sid]),
    q(
      `select id, amount_inr, kind, note, created_at from public.staff_wallet_ledger
        where staff_id = $1 order by created_at desc limit 40`,
      [sid],
    ),
    q(
      `select id, title, description, task_type, status, amount_inr, due_label, admin_note, shop_name, assigned_at, submitted_at
         from public.staff_tasks where staff_id = $1 order by assigned_at desc limit 50`,
      [sid],
    ),
    q(
      `select id, business_name, owner_name, phone, category, address, source, status, created_at
         from public.staff_onboardings where staff_id = $1 order by created_at desc limit 50`,
      [sid],
    ),
    q(
      `select
         (select count(*)::int from public.staff_onboardings where staff_id = $1) as vendors,
         (select count(*)::int from public.staff_tasks where staff_id = $1 and task_type = 'standee' and status in ('submitted','approved')) as standees,
         (select count(*)::int from public.staff_tasks where staff_id = $1 and task_type = 'kyc' and status in ('submitted','approved')) as kyc`,
      [sid],
    ),
  ]);
  return {
    staff: profile,
    wallet: wallet.rows[0] ?? { balance_inr: 0, lifetime_earned: 0, lifetime_withdrawn: 0 },
    ledger: ledger.rows,
    tasks: tasks.rows,
    onboarded: onboarded.rows,
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
  },
) {
  const staff = await requireActiveStaff(userId);
  if (!staff) return { ok: false as const, error: "Staff profile is not active" };
  const phone = last10(body.phone);
  if (phone.length !== 10) return { ok: false as const, error: "Enter a 10-digit mobile number" };
  const existing = await findUserByPhone(phone);
  const status = body.source === "link" && !existing ? "link_sent" : "pending";
  const { rows } = await q(
    `insert into public.staff_onboardings
       (staff_id, business_name, owner_name, phone, category, address, lat, lng, source, status, vendor_user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
  return { ok: true as const, onboarding: rows[0] };
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
    `update public.staff_onboardings set status = 'live' where vendor_user_id = $1 and status <> 'live'`,
    [vendorUserId],
  );
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
}) {
  const { rows } = await q(
    `insert into public.staff_tasks
       (staff_id, title, description, task_type, amount_inr, due_label, admin_note, shop_name, status, assigned_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'assigned',$9)
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
    ],
  );
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
