import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { requireAuth } from "../middleware/auth.js";
import { getPool } from "../lib/pg-client.js";
import { ensureVendorSchema } from "../lib/apply-vendor-schema.js";
import {
  ChatError,
  PAIR_FILTER,
  approveVendor,
  PROGRESS_LABELS,
  chatContext,
  chatUnlockState,
  chargeChatCredit,
  displayName,
  insertMessage,
  pairStage,
  recordProgress,
  type ChatContext,
} from "../lib/chat.js";

const q = (sql: string, params: unknown[] = []) => getPool().query(sql, params);
const uuid = z.string().uuid();

export const chatRouter = Router();
chatRouter.use(requireAuth);

function guard(fn: (req: Request, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ChatError) return fail(res, err.status, err.message);
      throw err;
    }
  });
}

async function ctxFrom(req: Request, peerHint?: unknown) {
  const id = uuid.safeParse(req.params.leadId);
  if (!id.success) throw new ChatError(400, "Invalid lead id");
  const peer = uuid.safeParse(peerHint ?? req.query.peer ?? (req.body as { peer_id?: string } | undefined)?.peer_id);
  return chatContext(id.data, req.userId!, peer.success ? peer.data : null);
}

function customerIdOf(ctx: ChatContext) {
  return ctx.lead.customer_id;
}

async function vendorUpi(vendorId: string) {
  const { rows } = await q(
    `select request_payload->>'upi' as upi, request_payload->>'holder' as holder from public.kyc_verifications
      where user_id = $1 and subject_type = 'vendor' and check_type = 'bank' order by created_at desc limit 1`,
    [vendorId],
  );
  return { upi: (rows[0]?.upi as string | undefined) || null, holder: (rows[0]?.holder as string | undefined) || null };
}

function shapeMessage(m: Record<string, unknown>, me: string) {
  const mine = m.sender_id === me;
  if (m.is_deleted && !mine) return { ...m, body: null, image_url: null, attachment: {}, original_body: null };
  if (!mine) return { ...m, original_body: null };
  return m;
}

// ── Inbox ───────────────────────────────────────────────────────────────────

chatRouter.get(
  "/inbox",
  guard(async (req, res) => {
    await ensureVendorSchema();
    const me = req.userId!;
    const asVendor = req.query.as === "vendor";
    await q(`update public.lead_messages set delivered_at = now() where recipient_id = $1 and delivered_at is null`, [me]);
    const sql = asVendor
      ? `select l.id as lead_id, l.sub_category_name, l.status as lead_status, l.created_at as lead_created_at,
                l.customer_id as peer_id, 'customer' as peer_role,
                coalesce(nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''), c.name, l.customer_name, 'Customer') as peer_name,
                c.avatar_url as peer_avatar, n.status as my_status,
                (l.customer_approved_vendor_id = $1) as approved,
                (l.customer_approved_vendor_id is not null and l.customer_approved_vendor_id <> $1) as lost,
                m.body as last_body, m.kind as last_kind, m.attachment as last_attachment, m.created_at as last_at, m.sender_id as last_sender,
                m.read_at as last_read_at, m.delivered_at as last_delivered_at, m.is_deleted as last_deleted,
                (select count(*)::int from public.lead_messages u
                  where u.lead_id = l.id and u.recipient_id = $1 and u.read_at is null) as unread
           from public.leads l
           join public.lead_notifications n on n.lead_id = l.id and n.vendor_id = $1
           left join public.customers c on c.user_id = l.customer_id
           left join lateral (
             select * from public.lead_messages m
              where m.lead_id = l.id and (m.sender_id = $1 or m.recipient_id = $1 or (m.sender_id = l.customer_id and m.recipient_id is null))
              order by m.created_at desc limit 1) m on true
          where $1 = any(coalesce(l.accepted_vendor_ids, '{}'))
          order by coalesce(m.created_at, n.responded_at, l.created_at) desc
          limit 200`
      : `select l.id as lead_id, l.sub_category_name, l.status as lead_status, l.created_at as lead_created_at,
                v.user_id as peer_id, 'vendor' as peer_role,
                coalesce(v.business_name, v.owner_name, 'Vendor') as peer_name, v.avatar_url as peer_avatar,
                coalesce(v.verified, false) as peer_verified, n.status as my_status,
                (l.customer_approved_vendor_id = v.user_id) as approved, false as lost,
                m.body as last_body, m.kind as last_kind, m.attachment as last_attachment, m.created_at as last_at, m.sender_id as last_sender,
                m.read_at as last_read_at, m.delivered_at as last_delivered_at, m.is_deleted as last_deleted,
                (select count(*)::int from public.lead_messages u
                  where u.lead_id = l.id and u.recipient_id = $1 and u.sender_id = v.user_id and u.read_at is null) as unread
           from public.leads l
           join lateral unnest(coalesce(l.accepted_vendor_ids, '{}')) as av(vendor_id) on true
           join public.vendors v on v.user_id = av.vendor_id
           left join public.lead_notifications n on n.lead_id = l.id and n.vendor_id = v.user_id
           left join lateral (
             select * from public.lead_messages m
              where m.lead_id = l.id and (m.sender_id = v.user_id or m.recipient_id = v.user_id or (m.sender_id = $1 and m.recipient_id is null))
              order by m.created_at desc limit 1) m on true
          where l.customer_id = $1
          order by coalesce(m.created_at, n.responded_at, l.created_at) desc
          limit 200`;
    const { rows } = await q(sql, [me]);
    const unread = rows.reduce((s, r) => s + Number(r.unread ?? 0), 0);
    return ok(res, { me, threads: rows, unread });
  }),
);

// ── Thread ──────────────────────────────────────────────────────────────────

chatRouter.get(
  "/:leadId",
  guard(async (req, res) => {
    const ctx = await ctxFrom(req);
    const { lead, me, role, peerId, vendorId } = ctx;
    const customerId = customerIdOf(ctx);
    const none = Promise.resolve({ rows: [] as Record<string, unknown>[] });
    await Promise.all([
      q(
        `insert into public.lead_chat_presence (lead_id, user_id, last_seen_at) values ($1, $2, now())
         on conflict (lead_id, user_id) do update set last_seen_at = now()`,
        [lead.id, me],
      ),
      peerId
        ? q(
            `update public.lead_messages set delivered_at = coalesce(delivered_at, now())
                   ${req.query.read === "0" ? "" : ", read_at = coalesce(read_at, now())"}
              where lead_id = $1 and recipient_id = $2 and sender_id = $3 and (read_at is null or delivered_at is null)`,
            [lead.id, me, peerId],
          )
        : none,
    ]);
    const [msgRows, presRows, peerRows, upi, peerList, ratingRows, stage, unlock] = await Promise.all([
      vendorId
        ? q(
            `select * from (select m.* from public.lead_messages m where ${PAIR_FILTER} order by m.created_at desc limit 500) x
              order by created_at asc`,
            [lead.id, vendorId, customerId],
          )
        : none,
      peerId
        ? q(
            `select last_seen_at, last_seen_at > now() - interval '12 seconds' as online, coalesce(typing_until > now(), false) as typing
               from public.lead_chat_presence where lead_id = $1 and user_id = $2`,
            [lead.id, peerId],
          )
        : none,
      !peerId
        ? none
        : role === "customer"
          ? q(
              `select user_id, business_name, owner_name, avatar_url, whatsapp, coalesce(verified, false) as verified,
                      coalesce(rating_avg, 0)::float as rating_avg, coalesce(rating_count, 0) as rating_count, trade, city
                 from public.vendors where user_id = $1`,
              [peerId],
            )
          : q(
              `select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), name) as name, avatar_url, phone
                 from public.customers where user_id = $1`,
              [peerId],
            ),
      peerId && role === "customer" ? vendorUpi(peerId) : Promise.resolve({ upi: null, holder: null }),
      role === "customer"
        ? q(
            `select v.user_id as id, coalesce(v.business_name, v.owner_name, 'Vendor') as name, v.avatar_url,
                    coalesce(v.verified, false) as verified, (l.customer_approved_vendor_id = v.user_id) as approved,
                    (select count(*)::int from public.lead_messages u
                      where u.lead_id = l.id and u.recipient_id = $2 and u.sender_id = v.user_id and u.read_at is null) as unread
               from public.leads l
               join lateral unnest(coalesce(l.accepted_vendor_ids, '{}')) with ordinality as av(vendor_id, ord) on true
               join public.vendors v on v.user_id = av.vendor_id
              where l.id = $1 order by approved desc, av.ord`,
            [lead.id, me],
          )
        : none,
      vendorId
        ? q(`select stars, comment, tags, created_at from public.vendor_reviews where lead_id = $1 and vendor_id = $2`, [lead.id, vendorId])
        : none,
      pairStage(ctx),
      chatUnlockState(ctx),
    ]);

    const messages = msgRows.rows.map((m) => shapeMessage(m, me));
    let peer: Record<string, unknown> | null = null;
    if (peerId) {
      const pres = presRows.rows[0];
      if (role === "customer") {
        const v = peerRows.rows[0];
        peer = {
          id: peerId,
          role: "vendor",
          name: v?.business_name || v?.owner_name || "Vendor",
          subtitle: v?.business_name && v?.owner_name ? v.owner_name : v?.city ?? null,
          avatar_url: v?.avatar_url ?? null,
          phone: v?.whatsapp ?? null,
          verified: !!v?.verified,
          rating_avg: v?.rating_avg ?? 0,
          rating_count: v?.rating_count ?? 0,
          upi_id: upi.upi,
        };
      } else {
        const c = peerRows.rows[0];
        peer = {
          id: peerId,
          role: "customer",
          name: c?.name || lead.customer_name || "Customer",
          subtitle: lead.address ?? null,
          avatar_url: c?.avatar_url ?? null,
          phone: c?.phone || lead.customer_phone || null,
          verified: false,
        };
      }
      Object.assign(peer, {
        online: !!pres?.online,
        typing: !!pres?.typing,
        last_seen_at: pres?.last_seen_at ?? null,
      });
    }

    const peers = peerList.rows;
    const rating = ratingRows.rows[0] ?? null;

    return ok(res, {
      me: { id: me, role },
      lead: {
        id: lead.id,
        status: lead.status,
        sub_category_name: lead.sub_category_name,
        address: lead.address,
        created_at: lead.created_at,
        approved_vendor_id: lead.customer_approved_vendor_id,
        source: lead.source,
      },
      ...stage,
      chat_unlock: unlock,
      peer,
      peers,
      rating,
      messages,
      server_time: new Date().toISOString(),
    });
  }),
);

// ── Messages ────────────────────────────────────────────────────────────────

const LatLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), label: z.string().max(200).optional() });
const QuoteItem = z.object({ name: z.string().trim().min(1).max(120), qty: z.number().positive().max(10000).default(1), price: z.number().min(0).max(10_000_000) });

const SendSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), body: z.string().trim().min(1).max(4000) }),
  z.object({ kind: z.literal("image"), image_url: z.string().url().max(2000), body: z.string().trim().max(1000).optional() }),
  z.object({ kind: z.literal("location"), attachment: LatLng }),
  z.object({
    kind: z.literal("quote"),
    attachment: z.object({ items: z.array(QuoteItem).min(1).max(30), note: z.string().max(500).optional(), visit_charge: z.number().min(0).max(100000).optional() }),
  }),
  z.object({
    kind: z.literal("payment"),
    attachment: z.object({ amount: z.number().positive().max(10_000_000), note: z.string().max(300).optional(), upi_id: z.string().trim().max(80).optional() }),
  }),
  z.object({ kind: z.literal("product"), attachment: z.object({ product_id: z.string().uuid() }) }),
]);

chatRouter.post(
  "/:leadId/messages",
  guard(async (req, res) => {
    const ctx = await ctxFrom(req);
    if (!ctx.peerId) return fail(res, 409, "No vendor has accepted this request yet");
    const parsed = SendSchema.safeParse({ kind: "text", ...req.body });
    if (!parsed.success) return zodFail(res, parsed.error);
    const m = parsed.data;
    const vendorOnly = m.kind === "quote" || m.kind === "payment" || m.kind === "product";
    if (vendorOnly && ctx.role !== "vendor") return fail(res, 403, "Only the vendor can send this");
    if (ctx.role === "vendor") await chargeChatCredit(ctx);

    let row;
    if (m.kind === "text") row = await insertMessage(ctx, { kind: "text", body: m.body });
    else if (m.kind === "image") row = await insertMessage(ctx, { kind: "image", image_url: m.image_url, body: m.body || null });
    else if (m.kind === "location") row = await insertMessage(ctx, { kind: "location", attachment: m.attachment });
    else if (m.kind === "quote") {
      const items = m.attachment.items.map((i) => ({ ...i, amount: Math.round(i.qty * i.price * 100) / 100 }));
      const visit = m.attachment.visit_charge ?? 0;
      const total = Math.round((items.reduce((s, i) => s + i.amount, 0) + visit) * 100) / 100;
      row = await insertMessage(ctx, {
        kind: "quote",
        attachment: { items, visit_charge: visit, note: m.attachment.note ?? null, total, status: "pending" },
      });
    } else if (m.kind === "payment") {
      const kyc = await vendorUpi(ctx.me);
      const upi = m.attachment.upi_id || kyc.upi;
      if (!upi || !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) return fail(res, 400, "Add a valid UPI ID (like name@okaxis) to request payment");
      row = await insertMessage(ctx, {
        kind: "payment",
        attachment: {
          amount: m.attachment.amount,
          note: m.attachment.note ?? null,
          upi_id: upi,
          payee: kyc.holder || (await displayName(ctx.me, "vendor")),
          status: "pending",
        },
      });
    } else {
      const { rows } = await q(`select id, name, price, mrp, image_url, unit from public.shop_products where id = $1 and user_id = $2`, [
        m.attachment.product_id,
        ctx.me,
      ]);
      const p = rows[0];
      if (!p) return fail(res, 404, "Product not found in your shop");
      row = await insertMessage(ctx, {
        kind: "product",
        attachment: { product_id: p.id, name: p.name, price: p.price != null ? Number(p.price) : null, mrp: p.mrp != null ? Number(p.mrp) : null, image_url: p.image_url, unit: p.unit },
      });
    }
    return ok(res, { message: row }, 201);
  }),
);

async function ownMessage(ctx: ChatContext, id: string) {
  const { rows } = await q(`select * from public.lead_messages where id = $1 and lead_id = $2`, [id, ctx.lead.id]);
  const m = rows[0];
  if (!m) throw new ChatError(404, "Message not found");
  return m;
}

chatRouter.patch(
  "/:leadId/messages/:id",
  guard(async (req, res) => {
    const ctx = await ctxFrom(req);
    const id = uuid.safeParse(req.params.id);
    const body = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(req.body);
    if (!id.success) return fail(res, 400, "Invalid message id");
    if (!body.success) return zodFail(res, body.error);
    const m = await ownMessage(ctx, id.data);
    if (m.sender_id !== ctx.me) return fail(res, 403, "You can only edit your own messages");
    if (m.is_deleted) return fail(res, 409, "Message was deleted");
    if ((m.kind ?? "text") !== "text" && m.kind !== "image") return fail(res, 409, "This message cannot be edited");
    const { rows } = await q(
      `update public.lead_messages set original_body = coalesce(original_body, body), body = $2, edited_at = now()
        where id = $1 returning *`,
      [id.data, body.data.body],
    );
    return ok(res, { message: rows[0] });
  }),
);

chatRouter.delete(
  "/:leadId/messages/:id",
  guard(async (req, res) => {
    const ctx = await ctxFrom(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid message id");
    const m = await ownMessage(ctx, id.data);
    if (m.sender_id !== ctx.me) return fail(res, 403, "You can only delete your own messages");
    if (m.kind === "system") return fail(res, 409, "This message cannot be deleted");
    const { rows } = await q(
      `update public.lead_messages set is_deleted = true, deleted_at = now(),
              original_body = coalesce(original_body, body, case when image_url is not null then '📷 Photo' end)
        where id = $1 returning *`,
      [id.data],
    );
    return ok(res, { message: rows[0] });
  }),
);

const RespondSchema = z.object({
  action: z.enum(["accept", "decline", "paid", "received", "cancel"]),
  utr: z.string().trim().max(40).optional(),
});

chatRouter.post(
  "/:leadId/messages/:id/respond",
  guard(async (req, res) => {
    const ctx = await ctxFrom(req);
    const id = uuid.safeParse(req.params.id);
    const body = RespondSchema.safeParse(req.body);
    if (!id.success) return fail(res, 400, "Invalid message id");
    if (!body.success) return zodFail(res, body.error);
    const m = await ownMessage(ctx, id.data);
    const att = (m.attachment ?? {}) as Record<string, unknown>;
    const status = String(att.status ?? "pending");
    const amt = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN")}`;
    const { action, utr } = body.data;
    let next: string;
    let note: string;
    let extra: Record<string, unknown> = {};

    if (m.kind === "quote") {
      if (ctx.role !== "customer" || m.sender_id !== ctx.peerId) return fail(res, 403, "Only the customer can answer this quote");
      if (status !== "pending") return fail(res, 409, `Quote already ${status}`);
      if (action !== "accept" && action !== "decline") return fail(res, 400, "Accept or decline the quote");
      next = action === "accept" ? "accepted" : "declined";
      note = action === "accept" ? `👍 Quote accepted · ${amt(att.total)}` : `✋ Quote declined · ${amt(att.total)}`;
      if (action === "accept") {
        await q(`update public.lead_notifications set quoted_price = $3 where lead_id = $1 and vendor_id = $2`, [ctx.lead.id, m.sender_id, att.total]);
      }
    } else if (m.kind === "payment") {
      if (action === "paid") {
        if (ctx.role !== "customer") return fail(res, 403, "Only the customer can mark this paid");
        if (status !== "pending") return fail(res, 409, `Payment already ${status}`);
        next = "paid";
        extra = { paid_at: new Date().toISOString(), utr: utr ?? null };
        note = `💳 Paid ${amt(att.amount)} via UPI${utr ? ` · UTR ${utr}` : ""}. Please confirm.`;
      } else if (action === "received") {
        if (ctx.role !== "vendor" || m.sender_id !== ctx.me) return fail(res, 403, "Only the vendor can confirm payment");
        if (status === "received" || status === "cancelled") return fail(res, 409, `Payment already ${status}`);
        next = "received";
        extra = { received_at: new Date().toISOString() };
        note = `✅ Payment of ${amt(att.amount)} received. Thank you!`;
      } else if (action === "cancel") {
        if (ctx.role !== "vendor" || m.sender_id !== ctx.me) return fail(res, 403, "Only the vendor can cancel this request");
        if (status !== "pending") return fail(res, 409, `Payment already ${status}`);
        next = "cancelled";
        note = `Payment request of ${amt(att.amount)} cancelled`;
      } else return fail(res, 400, "Invalid action for a payment request");
    } else return fail(res, 409, "Nothing to respond to");

    const { rows } = await q(
      `update public.lead_messages set attachment = coalesce(attachment, '{}'::jsonb) || $2::jsonb where id = $1 returning *`,
      [id.data, JSON.stringify({ status: next, responded_at: new Date().toISOString(), ...extra })],
    );
    await insertMessage(ctx, { kind: "system", body: note, attachment: { event: `${m.kind}_${next}`, ref: id.data } });
    return ok(res, { message: rows[0] });
  }),
);

// ── Presence, status, rating, report ────────────────────────────────────────

chatRouter.post(
  "/:leadId/typing",
  guard(async (req, res) => {
    const ctx = await ctxFrom(req);
    const typing = z.boolean().catch(true).parse((req.body as { typing?: unknown })?.typing);
    await q(
      `insert into public.lead_chat_presence (lead_id, user_id, last_seen_at, typing_until)
       values ($1, $2, now(), case when $3 then now() + interval '6 seconds' end)
       on conflict (lead_id, user_id) do update set last_seen_at = now(), typing_until = excluded.typing_until`,
      [ctx.lead.id, ctx.me, typing],
    );
    return ok(res, { typing });
  }),
);

const StatusSchema = z.object({
  action: z.enum(["approve", "decline", "complete", "on_the_way", "arrived", "working", "completed"]),
});

chatRouter.post(
  "/:leadId/status",
  guard(async (req, res) => {
    const ctx = await ctxFrom(req);
    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const { action } = parsed.data;
    const vendorId = ctx.vendorId;
    if (!vendorId) return fail(res, 409, "No vendor has accepted this request yet");
    if (["completed", "cancelled"].includes(ctx.lead.status) && action !== "completed") {
      return fail(res, 409, `This request is already ${ctx.lead.status}`);
    }

    if (ctx.role === "customer") {
      if (action === "approve") await approveVendor(ctx, vendorId);
      else if (action === "decline") {
        await q(`update public.lead_notifications set customer_declined_at = now() where lead_id = $1 and vendor_id = $2`, [ctx.lead.id, vendorId]);
        if (ctx.lead.customer_approved_vendor_id === vendorId) {
          await q(
            `update public.leads set customer_approved_vendor_id = null, status = 'placed', updated_at = now() where id = $1`,
            [ctx.lead.id],
          );
          ctx.lead.customer_approved_vendor_id = null;
        }
        await insertMessage(ctx, { kind: "system", body: "The customer is not going ahead with you for now.", attachment: { event: "declined" } });
      } else if (action === "complete") {
        if (ctx.lead.customer_approved_vendor_id !== vendorId) return fail(res, 409, "Choose this vendor before marking the job complete");
        await q(`update public.leads set status = 'completed', updated_at = now() where id = $1`, [ctx.lead.id]);
        await q(`update public.lead_notifications set status = 'success' where lead_id = $1 and vendor_id = $2`, [ctx.lead.id, vendorId]);
        await q(
          `insert into public.vendor_status_updates (vendor_id, user_id, lead_id, status, status_key)
           select $1, $1, $2, 'Completed', 'completed'
            where not exists (select 1 from public.vendor_status_updates where lead_id = $2 and vendor_id = $1 and status_key = 'completed')`,
          [vendorId, ctx.lead.id],
        );
        ctx.lead.status = "completed";
        await insertMessage(ctx, { kind: "system", body: "✅ The customer marked this job complete.", attachment: { event: "completed" } });
      } else return fail(res, 403, "Only the vendor can update job progress");
    } else {
      if (!(action in PROGRESS_LABELS)) return fail(res, 403, "Only the customer can do this");
      if (ctx.lead.customer_approved_vendor_id && ctx.lead.customer_approved_vendor_id !== ctx.me) {
        return fail(res, 409, "The customer chose another vendor");
      }
      await recordProgress(ctx, action);
    }
    const fresh = await chatContext(ctx.lead.id, ctx.me, ctx.peerId);
    return ok(res, { lead: { id: fresh.lead.id, status: fresh.lead.status, approved_vendor_id: fresh.lead.customer_approved_vendor_id }, ...(await pairStage(fresh)) });
  }),
);

const RatingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
  tags: z.array(z.string().trim().max(40)).max(8).optional(),
});

chatRouter.post(
  "/:leadId/rating",
  guard(async (req, res) => {
    const ctx = await ctxFrom(req);
    const parsed = RatingSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    if (ctx.role !== "customer") return fail(res, 403, "Only the customer can rate");
    const vendorId = ctx.vendorId;
    if (!vendorId) return fail(res, 409, "No vendor to rate");
    const { stage } = await pairStage(ctx);
    if (stage !== "completed") return fail(res, 409, "You can rate once the job is complete");
    const { rows: prev } = await q(`select id from public.vendor_reviews where lead_id = $1 and vendor_id = $2`, [ctx.lead.id, vendorId]);
    const { rows } = await q(
      `insert into public.vendor_reviews (lead_id, vendor_id, customer_id, stars, comment, tags)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (lead_id, vendor_id) do update set stars = excluded.stars, comment = excluded.comment, tags = excluded.tags, updated_at = now()
       returning stars, comment, tags, created_at`,
      [ctx.lead.id, vendorId, ctx.me, parsed.data.stars, parsed.data.comment ?? null, parsed.data.tags ?? []],
    );
    await q(
      `update public.vendors v set rating_avg = s.avg, rating_count = s.n
         from (select round(avg(stars)::numeric, 2) as avg, count(*)::int as n from public.vendor_reviews where vendor_id = $1) s
        where v.user_id = $1`,
      [vendorId],
    );
    if (!prev[0]) {
      await insertMessage(ctx, {
        kind: "system",
        body: `${"⭐".repeat(parsed.data.stars)} The customer rated you ${parsed.data.stars}/5${parsed.data.comment ? `: “${parsed.data.comment}”` : ""}`,
        attachment: { event: "rating", stars: parsed.data.stars },
      });
    }
    return ok(res, { rating: rows[0] });
  }),
);

chatRouter.post(
  "/:leadId/report",
  guard(async (req, res) => {
    const ctx = await ctxFrom(req);
    const parsed = z.object({ reason: z.string().trim().min(3).max(1000) }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    await q(`insert into public.feedback_reports (user_id, message) values ($1, $2)`, [
      ctx.me,
      `[chat report] lead ${ctx.lead.id} · ${ctx.role} ${ctx.me} about ${ctx.peerId ?? "-"}: ${parsed.data.reason}`,
    ]);
    return ok(res, { reported: true });
  }),
);
