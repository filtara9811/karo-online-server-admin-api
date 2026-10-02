import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";
import { hasServiceRole } from "../config/env.js";
import { getServiceRoleClient } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { acceptLeadForVendor, distanceSql, matchLeadToVendors, rejectLeadForVendor } from "../lib/vendor-leads.js";
import { getPool } from "../lib/pg-client.js";
import { ensureVendorSchema } from "../lib/apply-vendor-schema.js";
import { ChatError, approveVendor, chatContext, insertMessage } from "../lib/chat.js";

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export const leadsRouter = Router();
leadsRouter.use(requireAuth);

const CreateLeadSchema = z.object({
  sub_category_id: z.string().optional(),
  sub_category_name: z.string().min(1).max(160),
  item_ids: z.array(z.string()).optional(),
  item_names: z.array(z.string()).optional(),
  note: z.string().max(1000).optional(),
  address: z.string().max(500).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  vendor_types: z.array(z.enum(["wholesaler", "retailer", "manufacturer", "service"])).max(4).optional(),
  search_radius_km: z.number().min(1).max(50).optional(),
  verified_only: z.boolean().optional(),
  online_only: z.boolean().optional(),
});

leadsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = CreateLeadSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const body = parsed.data;
    const sb = hasServiceRole() ? getServiceRoleClient() : req.userClient!;
    const meta = (req.authUser?.user_metadata ?? {}) as { name?: string; phone?: string };
    const who = (
      await getPool().query(
        `select coalesce(nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''), c.name) as name,
                coalesce(c.phone, u.phone) as phone
           from (select $1::uuid as id) x
           left join public.customers c on c.user_id = x.id
           left join public.local_users u on u.id = x.id`,
        [req.userId],
      )
    ).rows[0] as { name?: string | null; phone?: string | null } | undefined;
    const row = {
      customer_id: req.userId,
      customer_name: meta.name || who?.name || null,
      customer_phone: meta.phone || who?.phone || null,
      sub_category_id: body.sub_category_id && isUuid(body.sub_category_id) ? body.sub_category_id : null,
      sub_category_name: body.sub_category_name,
      item_ids: (body.item_ids ?? []).filter(isUuid),
      item_names: body.item_names ?? [],
      note: body.note ?? null,
      address: body.address ?? null,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      status: "placed",
      source: "quick",
      vendor_types: body.vendor_types ?? null,
      search_radius_km: body.search_radius_km ?? null,
      verified_only: body.verified_only ?? false,
      online_only: body.online_only ?? false,
    };
    await ensureVendorSchema();
    const { data, error } = await sb.from("leads").insert(row).select("*").single();
    if (!error && data) {
      const match = await matchLeadToVendors(data.id).catch((err) => {
        console.warn("[leads] match", err instanceof Error ? err.message : err);
        return { notified: 0, auto_accepted: 0 };
      });
      return ok(res, { lead: data, match }, 201);
    }
    const { tableMissing, createMemLead } = await import("../lib/memory.js");
    if (error && tableMissing(error)) {
      const lead = createMemLead({
        customer_id: req.userId!,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        sub_category_id: row.sub_category_id,
        sub_category_name: row.sub_category_name,
        item_ids: row.item_ids,
        item_names: row.item_names,
        note: row.note,
        address: row.address,
        lat: row.lat,
        lng: row.lng,
      });
      return ok(res, { lead, seeded: true }, 201);
    }
    return fail(res, 400, error?.message ?? "Could not create lead");
  }),
);

const AcceptSchema = z.object({}).passthrough();
const RejectSchema = z.object({ reason: z.string().min(1).max(120) });
const MessageSchema = z.object({
  body: z.string().max(4000).optional(),
  image_url: z.string().max(4000).optional(),
  recipient_id: z.string().uuid().nullable().optional(),
  sender_role: z.enum(["customer", "vendor", "staff", "admin"]).optional(),
});

leadsRouter.post(
  "/:id/accept",
  asyncHandler(async (req, res) => {
    const parsed = z.string().uuid().safeParse(req.params.id);
    if (!parsed.success) return fail(res, 400, "Invalid lead id");
    AcceptSchema.parse(req.body ?? {});
    const result = await acceptLeadForVendor(parsed.data, req.userId!);
    if (!result.ok) return fail(res, result.reason === "not_a_vendor" ? 403 : 409, result.reason, result);
    return ok(res, { result });
  }),
);

leadsRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    const parsed = RejectSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await rejectLeadForVendor(id.data, req.userId!, parsed.data.reason);
    return ok(res, { result });
  }),
);

leadsRouter.get(
  "/mine",
  asyncHandler(async (req, res) => {
    await ensureVendorSchema();
    const uid = req.userId!;
    const pool = getPool();
    const [asCustomer, notifs] = await Promise.all([
      pool.query(
        `select l.*,
                (select count(*)::int from public.lead_messages m
                  where m.lead_id = l.id and m.recipient_id = $1 and m.read_at is null and not m.is_deleted) as unread,
                coalesce(array_length(l.accepted_vendor_ids, 1), 0) as accepted_count,
                v.user_id as vendor_id,
                coalesce(v.business_name, v.owner_name) as vendor_name,
                v.avatar_url as vendor_avatar,
                n.quoted_price::float as amount
           from public.leads l
           left join public.vendors v
             on v.user_id = coalesce(l.customer_approved_vendor_id, case when array_length(l.accepted_vendor_ids, 1) = 1 then l.accepted_vendor_ids[1] end)
           left join public.lead_notifications n on n.lead_id = l.id and n.vendor_id = v.user_id
          where l.customer_id = $1
          order by coalesce(l.updated_at, l.created_at) desc
          limit 200`,
        [uid],
      ),
      pool.query(
        `select n.*, to_jsonb(l) as leads
           from public.lead_notifications n
           join public.leads l on l.id = n.lead_id
          where n.vendor_id = $1
          order by n.created_at desc
          limit 200`,
        [uid],
      ),
    ]);
    return ok(res, { as_customer: asCustomer.rows, as_vendor: notifs.rows, leads: asCustomer.rows });
  }),
);

leadsRouter.get(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    const { data, error } = await req.userClient!
      .from("lead_messages")
      .select("*")
      .eq("lead_id", id.data)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) {
      const { tableMissing, listMemMessages } = await import("../lib/memory.js");
      if (tableMissing(error)) return ok(res, { messages: listMemMessages(id.data), seeded: true });
      return fail(res, 400, error.message);
    }
    return ok(res, { messages: data ?? [] });
  }),
);

leadsRouter.post(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    const parsed = MessageSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    if (!parsed.data.body?.trim() && !parsed.data.image_url) return fail(res, 400, "Message is empty");
    let ctx;
    try {
      ctx = await chatContext(id.data, req.userId!, parsed.data.recipient_id);
    } catch (err) {
      if (err instanceof ChatError) return fail(res, err.status, err.message);
      throw err;
    }
    const message = await insertMessage(ctx, {
      kind: parsed.data.image_url ? "image" : "text",
      body: parsed.data.body?.trim() || null,
      image_url: parsed.data.image_url ?? null,
    });
    return ok(res, { message });
  }),
);

async function ownLead(leadId: string, userId: string) {
  await ensureVendorSchema();
  const { rows } = await getPool().query(`select * from public.leads where id = $1 and customer_id = $2`, [leadId, userId]);
  return rows[0] ?? null;
}

leadsRouter.get(
  "/:id/vendors",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    const lead = await ownLead(id.data, req.userId!);
    if (!lead) return fail(res, 404, "Lead not found");
    const pool = getPool();
    const dist = distanceSql("$2::float8", "$3::float8", "coalesce(v.live_lat, v.lat)", "coalesce(v.live_lng, v.lng)");
    const { rows: vendors } = await pool.query(
      `select v.user_id as vendor_id, v.business_name, v.owner_name, v.avatar_url, v.cover_image_url,
              coalesce(v.verified, false) as verified, coalesce(v.is_premium, false) as is_premium,
              v.whatsapp as phone, v.whatsapp, v.trade, n.responded_at as accepted_at, n.quoted_price,
              coalesce(v.live_lat, v.lat) as lat, coalesce(v.live_lng, v.lng) as lng, v.rating_avg, v.rating_count, v.is_online,
              case when $2::float8 is null or coalesce(v.live_lat, v.lat) is null then null else ${dist} end as distance_km,
              pr.price_min, pr.price_max
         from public.vendors v
         left join public.lead_notifications n on n.lead_id = $1 and n.vendor_id = v.user_id
         left join lateral (
           select min(m.price_min) as price_min, max(m.price_max) as price_max
             from public.vendor_item_mappings m join public.catalog_items ci on ci.id = m.item_id
            where m.vendor_id = v.user_id and coalesce(m.is_active, true)
              and (ci.id = any($4::uuid[]) or ci.category_id = $5::uuid)) pr on true
        where v.user_id = any($6::uuid[])
        order by n.responded_at nulls last`,
      [id.data, lead.lat ?? null, lead.lng ?? null, lead.item_ids ?? [], lead.sub_category_id ?? null, lead.accepted_vendor_ids ?? []],
    );
    const { rows: counts } = await pool.query(
      `select count(*)::int as notified, count(*) filter (where status = 'pending')::int as pending
         from public.lead_notifications where lead_id = $1`,
      [id.data],
    );
    return ok(res, {
      lead: {
        id: lead.id,
        status: lead.status,
        accepted_count: lead.accepted_count ?? vendors.length,
        search_radius_km: lead.search_radius_km,
        approved_vendor_id: lead.customer_approved_vendor_id,
        created_at: lead.created_at,
        lat: lead.lat,
        lng: lead.lng,
        address: lead.address,
      },
      notified: counts[0]?.notified ?? 0,
      pending: counts[0]?.pending ?? 0,
      vendors,
    });
  }),
);

leadsRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z.object({ vendor_id: z.string().uuid() }).safeParse(req.body);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    if (!body.success) return zodFail(res, body.error);
    const lead = await ownLead(id.data, req.userId!);
    if (!lead) return fail(res, 404, "Lead not found");
    if (!((lead.accepted_vendor_ids ?? []) as string[]).includes(body.data.vendor_id)) {
      return fail(res, 409, "This vendor has not accepted your request");
    }
    const ctx = await chatContext(id.data, req.userId!, body.data.vendor_id);
    await approveVendor(ctx, body.data.vendor_id);
    const { rows } = await getPool().query(`select * from public.leads where id = $1`, [id.data]);
    return ok(res, { lead: rows[0] });
  }),
);

leadsRouter.post(
  "/:id/expand",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z.object({ radius_km: z.number().min(1).max(100) }).safeParse(req.body);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    if (!body.success) return zodFail(res, body.error);
    const lead = await ownLead(id.data, req.userId!);
    if (!lead) return fail(res, 404, "Lead not found");
    await getPool().query(
      `update public.leads set search_radius_km = $2, vendor_types = null, verified_only = false, updated_at = now() where id = $1`,
      [id.data, body.data.radius_km],
    );
    const match = await matchLeadToVendors(id.data);
    return ok(res, { match });
  }),
);

leadsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    const { data: lead, error } = await req.userClient!.from("leads").select("*").eq("id", id.data).maybeSingle();
    if (error) {
      const { tableMissing, getMemLead } = await import("../lib/memory.js");
      if (tableMissing(error)) {
        const mem = getMemLead(id.data);
        if (mem) return ok(res, { lead: mem, seeded: true });
        return fail(res, 404, "Lead not found");
      }
      return fail(res, 400, error.message);
    }
    if (lead) return ok(res, { lead });
    const { data: brief } = await req.userClient!.rpc("get_pending_lead_brief", { p_lead_id: id.data });
    const row = Array.isArray(brief) ? brief[0] : brief;
    if (!row) return fail(res, 404, "Lead not found");
    return ok(res, { lead: row, brief: true });
  }),
);
