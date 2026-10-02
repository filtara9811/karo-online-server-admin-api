import { getPool } from "./pg-client.js";
import { ensureVendorSchema } from "./apply-vendor-schema.js";
import { pushToUser } from "./push.js";

const q = (sql: string, params: unknown[] = []) => getPool().query(sql, params);

export type ChatRole = "customer" | "vendor";

export type ChatLead = {
  id: string;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  sub_category_name: string | null;
  address: string | null;
  status: string;
  created_at: string;
  accepted_vendor_ids: string[] | null;
  customer_approved_vendor_id: string | null;
  source: string | null;
};

export type ChatContext = {
  lead: ChatLead;
  me: string;
  role: ChatRole;
  /** The other side of this 1:1 thread: a vendor for customers, the customer for vendors. */
  peerId: string | null;
  vendorId: string | null;
};

export const PROGRESS_LABELS: Record<string, string> = {
  on_the_way: "On the way",
  arrived: "Arrived",
  working: "Working",
  completed: "Completed",
};

export class ChatError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Resolves who is chatting in a lead thread. Only the customer and vendors who accepted the lead may read or write. */
export async function chatContext(leadId: string, me: string, peerHint?: string | null): Promise<ChatContext> {
  await ensureVendorSchema();
  const { rows } = await q(
    `select id, customer_id, customer_name, customer_phone, sub_category_name, address, status, created_at,
            accepted_vendor_ids, customer_approved_vendor_id, source
       from public.leads where id = $1`,
    [leadId],
  );
  const lead = rows[0] as ChatLead | undefined;
  if (!lead) throw new ChatError(404, "Lead not found");
  const accepted = (lead.accepted_vendor_ids ?? []) as string[];
  if (lead.customer_id === me) {
    const peer =
      peerHint && accepted.includes(peerHint) ? peerHint : (lead.customer_approved_vendor_id ?? accepted[0] ?? null);
    return { lead, me, role: "customer", peerId: peer, vendorId: peer };
  }
  if (accepted.includes(me)) return { lead, me, role: "vendor", peerId: lead.customer_id, vendorId: me };
  throw new ChatError(403, "Accept the lead to chat with the customer");
}

/** Coins a vendor pays to reply to a customer who messaged them directly from their profile (admin setting `chat_credit_coins`). */
export async function chatCreditCost(): Promise<number> {
  try {
    const { rows } = await q(`select value from public.app_settings where key = 'chat_credit_coins'`);
    const raw = rows[0]?.value;
    const n = Number(raw != null && typeof raw === "object" ? (raw as { coins?: unknown }).coins : raw);
    return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
  } catch {
    return 0;
  }
}

/** Direct profile chats ("shop" leads) are free for the customer; the vendor pays once per customer to reply. */
export function isDirectChat(lead: ChatLead) {
  return lead.source === "shop";
}

/** Whether this vendor already paid (or sent anything) in this thread, plus the price. Only meaningful for direct chats. */
export async function chatUnlockState(ctx: ChatContext) {
  if (ctx.role !== "vendor" || !isDirectChat(ctx.lead)) return null;
  const cost = await chatCreditCost();
  const { rows } = await q(`select 1 from public.lead_messages where lead_id = $1 and sender_id = $2 limit 1`, [ctx.lead.id, ctx.me]);
  return { cost, paid: rows.length > 0 || cost === 0 };
}

/** Charges the vendor's LeadX coins before their first reply in a direct chat. Throws 402 when the wallet is short. */
export async function chargeChatCredit(ctx: ChatContext) {
  const state = await chatUnlockState(ctx);
  if (!state || state.paid) return { charged: 0 };
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(`insert into public.vendor_wallets (vendor_id) values ($1) on conflict (vendor_id) do nothing`, [ctx.me]);
    const w = await client.query(`select leadx_coins from public.vendor_wallets where vendor_id = $1 for update`, [ctx.me]);
    const have = Number(w.rows[0]?.leadx_coins ?? 0);
    if (have < state.cost) {
      await client.query("rollback");
      throw new ChatError(402, `Replying to a new customer costs ${state.cost} LeadX ${state.cost === 1 ? "coin" : "coins"}. Add coins to chat.`);
    }
    await client.query(
      `update public.vendor_wallets
          set leadx_coins = coalesce(leadx_coins, 0) - $2, lifetime_coins_used = coalesce(lifetime_coins_used, 0) + $2, updated_at = now()
        where vendor_id = $1`,
      [ctx.me, state.cost],
    );
    await client.query(
      `insert into public.wallet_transactions (vendor_id, user_id, amount_inr, kind, purpose, direction, coins, description, ref, wallet_kind, status)
       values ($1, $1, 0, 'debit', 'chat_unlock', 'debit', $2, $3, $4, 'leadx', 'success')`,
      [ctx.me, state.cost, `Chat with ${ctx.lead.customer_name ?? "customer"}`, ctx.lead.id],
    );
    await client.query("commit");
    return { charged: state.cost };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** SQL filter for the messages of one customer↔vendor pair ($1 lead, $2 vendor, $3 customer). */
export const PAIR_FILTER = `m.lead_id = $1 and (
  m.sender_id = $2 or m.recipient_id = $2 or (m.sender_id = $3 and m.recipient_id is null))`;

export async function displayName(userId: string, role: ChatRole) {
  if (role === "vendor") {
    const { rows } = await q(`select business_name, owner_name from public.vendors where user_id = $1`, [userId]);
    return (rows[0]?.business_name || rows[0]?.owner_name || "Vendor") as string;
  }
  const { rows } = await q(
    `select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), name) as name
       from public.customers where user_id = $1`,
    [userId],
  );
  return (rows[0]?.name || "Customer") as string;
}

function previewOf(kind: string, body: string | null, att: Record<string, unknown>) {
  const amt = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN")}`;
  switch (kind) {
    case "image":
      return body ? `📷 ${body}` : "📷 Photo";
    case "location":
      return "📍 Location";
    case "quote":
      return `💰 Quote: ${amt(att.total)}`;
    case "payment":
      return `💳 Payment request: ${amt(att.amount)}`;
    case "product":
      return `🛍️ ${att.name ?? "Product"}${att.price != null ? ` — ${amt(att.price)}` : ""}`;
    default:
      return body ?? "";
  }
}

export type NewMessage = {
  kind?: string;
  body?: string | null;
  image_url?: string | null;
  attachment?: Record<string, unknown>;
};

/** Inserts a message in the pair thread and pushes it to the other side unless they are looking at the chat. */
export async function insertMessage(ctx: ChatContext, msg: NewMessage, opts: { push?: boolean } = {}) {
  const kind = msg.kind ?? "text";
  const att = msg.attachment ?? {};
  const body = msg.body ?? (kind === "text" || kind === "system" ? null : previewOf(kind, null, att));
  const { rows } = await q(
    `insert into public.lead_messages (lead_id, sender_id, sender_role, recipient_id, body, image_url, kind, attachment)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) returning *`,
    [ctx.lead.id, ctx.me, ctx.role, ctx.peerId, body, msg.image_url ?? null, kind, JSON.stringify(att)],
  );
  await q(`update public.lead_chat_presence set typing_until = null where lead_id = $1 and user_id = $2`, [ctx.lead.id, ctx.me]);
  if (opts.push !== false && ctx.peerId) void notifyPeer(ctx, previewOf(kind, body, att)).catch(() => null);
  return rows[0];
}

async function notifyPeer(ctx: ChatContext, preview: string) {
  const { rows } = await q(
    `select last_seen_at > now() - interval '8 seconds' as watching from public.lead_chat_presence where lead_id = $1 and user_id = $2`,
    [ctx.lead.id, ctx.peerId],
  );
  if (rows[0]?.watching) return;
  const name = await displayName(ctx.me, ctx.role);
  const toVendor = ctx.role === "customer";
  await pushToUser({
    userId: ctx.peerId!,
    title: toVendor ? `💬 ${name}` : `💬 ${name} · ${ctx.lead.sub_category_name ?? "Your request"}`,
    body: preview.slice(0, 180),
    actionUrl: toVendor ? `/vendor/chat/${ctx.lead.id}` : `/chat/${ctx.lead.id}?peer=${ctx.me}`,
    channel: "message",
    tag: `chat_${ctx.lead.id}_${ctx.me}`,
    extraData: { kind: "chat", lead_id: ctx.lead.id, peer_id: ctx.me, role: toVendor ? "vendor" : "customer" },
  });
}

/** Vendor job progress: timeline row, notification status, lead completion and a system message to the customer. */
export async function recordProgress(ctx: ChatContext, key: keyof typeof PROGRESS_LABELS | string) {
  const label = PROGRESS_LABELS[key];
  if (!label) throw new ChatError(400, "Unknown status");
  await q(
    `insert into public.vendor_status_updates (vendor_id, user_id, lead_id, status, status_key) values ($1, $1, $2, $3, $4)`,
    [ctx.me, ctx.lead.id, label, key],
  );
  await q(
    `update public.lead_notifications set status = $3, vendor_started_at = coalesce(vendor_started_at, now())
      where lead_id = $1 and vendor_id = $2`,
    [ctx.lead.id, ctx.me, key === "completed" ? "success" : "in_process"],
  );
  if (key === "completed") {
    await q(`update public.leads set status = 'completed', updated_at = now() where id = $1`, [ctx.lead.id]);
  }
  const icons: Record<string, string> = { on_the_way: "🛵", arrived: "📍", working: "🛠️", completed: "✅" };
  return insertMessage(ctx, { kind: "system", body: `${icons[key]} ${label}`, attachment: { event: "progress", status_key: key } });
}

/** Customer chooses a vendor; the previously chosen vendor (if any) is told in their own thread. */
export async function approveVendor(ctx: ChatContext, vendorId: string) {
  const previous = ctx.lead.customer_approved_vendor_id;
  await q(
    `update public.leads set customer_approved_vendor_id = $2, accepted_vendor_id = $2,
            status = case when status in ('completed', 'cancelled') then status else 'approved' end, updated_at = now()
      where id = $1`,
    [ctx.lead.id, vendorId],
  );
  await q(`update public.lead_notifications set customer_declined_at = null where lead_id = $1 and vendor_id = $2`, [ctx.lead.id, vendorId]);
  ctx.lead.customer_approved_vendor_id = vendorId;
  await insertMessage(
    { ...ctx, peerId: vendorId, vendorId },
    { kind: "system", body: "🎉 You have been chosen for this job. Please go ahead.", attachment: { event: "approved" } },
  );
  if (previous && previous !== vendorId) {
    await insertMessage(
      { ...ctx, peerId: previous, vendorId: previous },
      { kind: "system", body: "The customer has chosen another vendor for this job.", attachment: { event: "switched" } },
    );
  }
}

/** Stage of one customer↔vendor pair, used for the chat status banner. */
export async function pairStage(ctx: ChatContext) {
  const vendorId = ctx.vendorId;
  const lead = ctx.lead;
  if (!vendorId) return { stage: "waiting", steps_done: [] as string[] };
  const { rows } = await q(
    `select n.status, n.customer_declined_at,
            coalesce((select array_agg(distinct s.status_key) from public.vendor_status_updates s
                       where s.lead_id = $1 and s.vendor_id = $2 and s.status_key is not null), '{}') as steps
       from public.lead_notifications n where n.lead_id = $1 and n.vendor_id = $2`,
    [lead.id, vendorId],
  );
  const n = rows[0] ?? {};
  const steps = (n.steps ?? []) as string[];
  const approved = lead.customer_approved_vendor_id === vendorId;
  let stage = "accepted";
  if (lead.status === "cancelled") stage = "cancelled";
  else if (n.customer_declined_at && !approved) stage = "declined";
  else if (lead.customer_approved_vendor_id && !approved) stage = "lost";
  else if (steps.includes("completed") || (approved && lead.status === "completed")) stage = "completed";
  else if (steps.includes("working")) stage = "working";
  else if (steps.includes("arrived")) stage = "arrived";
  else if (steps.includes("on_the_way")) stage = "on_the_way";
  else if (approved) stage = "approved";
  return { stage, steps_done: steps, approved };
}
