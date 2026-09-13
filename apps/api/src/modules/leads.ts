import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";
import { hasServiceRole } from "../config/env.js";
import { getServiceRoleClient } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

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
});

leadsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = CreateLeadSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const body = parsed.data;
    const sb = hasServiceRole() ? getServiceRoleClient() : req.userClient!;
    const row = {
      customer_id: req.userId,
      customer_name: (req.authUser?.user_metadata as { name?: string } | undefined)?.name ?? null,
      customer_phone: (req.authUser?.user_metadata as { phone?: string } | undefined)?.phone ?? null,
      sub_category_id: body.sub_category_id ?? null,
      sub_category_name: body.sub_category_name,
      item_ids: body.item_ids ?? [],
      item_names: body.item_names ?? [],
      note: body.note ?? null,
      address: body.address ?? null,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      status: "placed",
      source: "quick",
    };
    const { data, error } = await sb.from("leads").insert(row).select("*").single();
    if (!error && data) return ok(res, { lead: data }, 201);
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
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = z.string().uuid().safeParse(req.params.id);
    if (!parsed.success) return fail(res, 400, "Invalid lead id");
    AcceptSchema.parse(req.body ?? {});
    const admin = getServiceRoleClient();
    const { data: vendor } = await admin.from("vendors").select("user_id").eq("user_id", req.userId!).maybeSingle();
    if (!vendor) return fail(res, 403, "not_a_vendor");
    const { data: result, error } = await admin.rpc("accept_lead_for_vendor", {
      _lead_id: parsed.data,
      _vendor_id: req.userId,
    });
    if (error) return fail(res, 400, error.message);
    return ok(res, { result });
  }),
);

leadsRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid lead id");
    const parsed = RejectSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const admin = getServiceRoleClient();
    const { data: vendor } = await admin.from("vendors").select("user_id").eq("user_id", req.userId!).maybeSingle();
    if (!vendor) return fail(res, 403, "not_a_vendor");
    const { data: result, error } = await admin.rpc("reject_lead_for_vendor", {
      _lead_id: id.data,
      _vendor_id: req.userId,
      _reason: parsed.data.reason,
    });
    if (error) return fail(res, 400, error.message);
    return ok(res, { result });
  }),
);

leadsRouter.get(
  "/mine",
  asyncHandler(async (req, res) => {
    const sb = req.userClient!;
    const uid = req.userId!;
    const [{ data: asCustomer, error: cErr }, { data: notifs, error: nErr }] = await Promise.all([
      sb
        .from("leads")
        .select("*")
        .eq("customer_id", uid)
        .order("updated_at", { ascending: false })
        .limit(200),
      sb
        .from("lead_notifications")
        .select("*, leads(*)")
        .eq("vendor_id", uid)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (cErr || nErr) {
      const { tableMissing, listMemLeads } = await import("../lib/memory.js");
      if (tableMissing(cErr) || tableMissing(nErr)) {
        const rows = listMemLeads(uid);
        return ok(res, { as_customer: rows, as_vendor: [], leads: rows, seeded: true });
      }
      if (cErr) return fail(res, 400, cErr.message);
      if (nErr) return fail(res, 400, nErr.message);
    }
    return ok(res, { as_customer: asCustomer ?? [], as_vendor: notifs ?? [], leads: asCustomer ?? [] });
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
    const { data: lead } = await req.userClient!.from("leads").select("customer_id, accepted_vendor_id, accepted_vendor_ids").eq("id", id.data).maybeSingle();
    const vendorIds = [lead?.accepted_vendor_id, ...((lead?.accepted_vendor_ids ?? []) as string[])].filter(Boolean);
    const senderRole =
      parsed.data.sender_role ??
      (lead?.customer_id === req.userId ? "customer" : vendorIds.includes(req.userId!) ? "vendor" : "customer");
    const recipientId =
      parsed.data.recipient_id ??
      (senderRole === "customer" ? (lead?.accepted_vendor_id ?? null) : (lead?.customer_id ?? null));
    const { data, error } = await req.userClient!
      .from("lead_messages")
      .insert({
        lead_id: id.data,
        sender_id: req.userId,
        sender_role: senderRole,
        recipient_id: recipientId,
        body: parsed.data.body ?? null,
        image_url: parsed.data.image_url ?? null,
      })
      .select("*")
      .single();
    if (error) {
      const { tableMissing, addMemMessage } = await import("../lib/memory.js");
      if (tableMissing(error)) {
        const message = addMemMessage(id.data, req.userId!, parsed.data.body ?? "", senderRole);
        return ok(res, { message, seeded: true });
      }
      return fail(res, 400, error.message);
    }
    return ok(res, { message: data });
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
