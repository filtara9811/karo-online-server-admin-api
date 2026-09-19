import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { tryServiceRole } from "../lib/supabase.js";
import { parseListQuery } from "../lib/geo.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { seedSmsGateways } from "../lib/seed-admin.js";
import {
  ADMIN_CRUD_TABLES,
  ApprovalSchema,
  BlockSchema,
  KycStatusSchema,
  LookupSchema,
  WalletSchema,
  adjustWallet,
  customerPatchSchema,
  getAdminStats,
  getUserFull,
  isAllowedTable,
  lookupUser,
  setKycStatus,
  setUserBlock,
  setVendorApproval,
  updateCustomerProfile,
  updateVendorProfile,
  vendorPatchSchema,
} from "../lib/admin-lookup.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    return ok(res, {
      roles: req.roles ?? [],
      userId: req.userId,
      email: req.authUser?.email ?? null,
      user: req.authUser,
    });
  }),
);

adminRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    return ok(res, await getAdminStats(req.userClient!));
  }),
);

const TABLE_ORDER: Record<string, string> = {
  maps_services: "priority",
  firebase_services: "priority",
  payment_gateways: "priority",
  cashfree_services: "priority",
  sms_gateways: "updated_at",
  whatsapp_providers: "updated_at",
  app_settings: "key",
};

async function listTable(
  res: import("express").Response,
  sb: import("../lib/pg-client.js").DbClient,
  table: string,
  req: import("express").Request,
  searchCols: string[] = [],
) {
  const { limit, offset, q } = parseListQuery(req.query as Record<string, unknown>);
  const run = async (orderCol: string | null) => {
    let query = sb.from(table).select("*", { count: "exact" }).range(offset, offset + limit - 1);
    if (q && searchCols.length) {
      query = query.or(searchCols.map((c) => `${c}.ilike.%${q}%`).join(","));
    }
    if (orderCol) query = query.order(orderCol, { ascending: orderCol === "priority" || orderCol === "key" });
    return query;
  };
  const requested = typeof req.query.order === "string" ? req.query.order : TABLE_ORDER[table] ?? "updated_at";
  let { data, error, count } = await run(requested);
  if (error && /column|does not exist|42703/i.test(error.message)) {
    const retry = await run(null);
    data = retry.data;
    error = retry.error;
    count = retry.count;
  }
  if (error) {
    const { tableMissing, memTableList, filterMemLeads } = await import("../lib/memory.js");
    if (tableMissing(error)) {
      if (table === "leads") {
        const bucket = typeof req.query.bucket === "string" ? req.query.bucket : "all";
        const rows = filterMemLeads(bucket);
        return ok(res, { rows, leads: rows, count: rows.length, limit, offset, seeded: true });
      }
      const rows = memTableList(table);
      return ok(res, { rows, count: rows.length, limit, offset, seeded: true });
    }
    return fail(res, 400, error.message);
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return ok(res, { rows, count: count ?? rows.length, limit, offset });
}

adminRouter.get(
  "/customers",
  asyncHandler(async (req, res) => {
    return listTable(res, req.userClient!, "customers", req, ["name", "email", "phone", "support_code"]);
  }),
);

adminRouter.get(
  "/vendors",
  asyncHandler(async (req, res) => {
    return listTable(res, req.userClient!, "vendors", req, ["business_name", "owner_name", "whatsapp", "email"]);
  }),
);

adminRouter.get(
  "/staff",
  asyncHandler(async (req, res) => {
    const sb = req.userClient!;
    const [{ data: roles, error: rErr }, { data: profiles, error: pErr }] = await Promise.all([
      sb.from("user_roles").select("*").order("created_at", { ascending: false }),
      sb.from("staff_profiles").select("*").order("created_at", { ascending: false }),
    ]);
    if (rErr || pErr) {
      const { tableMissing } = await import("../lib/memory.js");
      if (tableMissing(rErr) || tableMissing(pErr)) {
        return ok(res, { roles: [{ role: "super_admin", email: "admin@karoonline.local" }], profiles: [], seeded: true });
      }
      if (rErr) return fail(res, 400, rErr.message);
      if (pErr) return fail(res, 400, pErr.message);
    }
    return ok(res, { roles: roles ?? [], profiles: profiles ?? [] });
  }),
);

adminRouter.get(
  "/leads",
  asyncHandler(async (req, res) => {
    const bucket = typeof req.query.bucket === "string" ? req.query.bucket : "all";
    const { data, error } = await req.userClient!.rpc("admin_list_leads_dashboard", {
      _bucket: bucket,
      _limit: Number(req.query.limit) || 200,
    });
    if (!error) return ok(res, { leads: data ?? [], source: "rpc" });
    return listTable(res, req.userClient!, "leads", req, ["customer_name", "customer_phone", "sub_category_name", "status"]);
  }),
);

adminRouter.post(
  "/leads",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        action: z.enum(["rebroadcast", "marketplace", "fulfill"]),
        lead_id: z.string().uuid(),
        reason: z.string().max(160).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const { action, lead_id, reason } = parsed.data;
    const sb = req.userClient!;
    if (action === "rebroadcast") {
      const { error } = await sb.rpc("admin_rebroadcast_lead", { _lead_id: lead_id });
      if (!error) return ok(res, { action, lead_id });
    }
    if (action === "marketplace") {
      const { error } = await sb
        .from("leads")
        .update({
          is_marketplace: true,
          marketplace_reason: reason ?? "admin",
          marketplace_at: new Date().toISOString(),
        })
        .eq("id", lead_id);
      if (!error) return ok(res, { action, lead_id });
    }
    if (action === "fulfill") {
      const { error } = await sb.from("leads").update({ status: "fulfilled" }).eq("id", lead_id);
      if (!error) return ok(res, { action, lead_id });
    }
    const { updateMemLead } = await import("../lib/memory.js");
    const patch =
      action === "marketplace"
        ? { is_marketplace: true, marketplace_reason: reason ?? "admin", marketplace_at: new Date().toISOString(), status: "placed" }
        : action === "fulfill"
          ? { status: "fulfilled", is_marketplace: false }
          : { status: "placed", is_marketplace: false, marketplace_reason: null };
    const lead = updateMemLead(lead_id, patch);
    if (!lead) return fail(res, 404, "Lead not found");
    return ok(res, { action, lead, seeded: true });
  }),
);

adminRouter.get(
  "/catalog/categories",
  asyncHandler(async (req, res) => {
    return listTable(res, req.userClient!, "categories", req, ["name", "slug"]);
  }),
);

adminRouter.get(
  "/catalog/items",
  asyncHandler(async (req, res) => {
    return listTable(res, req.userClient!, "catalog_items", req, ["name", "slug"]);
  }),
);

adminRouter.post(
  "/lookup",
  asyncHandler(async (req, res) => {
    const parsed = LookupSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await lookupUser(req.userClient!, parsed.data.q));
  }),
);

adminRouter.get(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const parsed = z.string().uuid().safeParse(req.params.userId);
    if (!parsed.success) return fail(res, 400, "Invalid user id");
    return ok(res, await getUserFull(req.userClient!, parsed.data));
  }),
);

adminRouter.patch(
  "/users/:userId/customer",
  asyncHandler(async (req, res) => {
    const uid = z.string().uuid().safeParse(req.params.userId);
    if (!uid.success) return fail(res, 400, "Invalid user id");
    const parsed = customerPatchSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await updateCustomerProfile(req.userClient!, uid.data, parsed.data));
  }),
);

adminRouter.patch(
  "/users/:userId/vendor",
  asyncHandler(async (req, res) => {
    const uid = z.string().uuid().safeParse(req.params.userId);
    if (!uid.success) return fail(res, 400, "Invalid user id");
    const parsed = vendorPatchSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await updateVendorProfile(req.userClient!, uid.data, parsed.data));
  }),
);

adminRouter.post(
  "/users/:userId/wallet",
  asyncHandler(async (req, res) => {
    const uid = z.string().uuid().safeParse(req.params.userId);
    if (!uid.success) return fail(res, 400, "Invalid user id");
    const parsed = WalletSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await adjustWallet(req.userClient!, uid.data, parsed.data));
  }),
);

adminRouter.post(
  "/users/:userId/block",
  asyncHandler(async (req, res) => {
    const uid = z.string().uuid().safeParse(req.params.userId);
    if (!uid.success) return fail(res, 400, "Invalid user id");
    const parsed = BlockSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await setUserBlock(req.userClient!, uid.data, parsed.data.blocked));
  }),
);

adminRouter.post(
  "/vendors/:userId/approval",
  asyncHandler(async (req, res) => {
    const uid = z.string().uuid().safeParse(req.params.userId);
    if (!uid.success) return fail(res, 400, "Invalid user id");
    const parsed = ApprovalSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await setVendorApproval(req.userClient!, uid.data, parsed.data.approved));
  }),
);

adminRouter.post(
  "/kyc/:id/status",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid kyc id");
    const parsed = KycStatusSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await setKycStatus(req.userClient!, id.data, parsed.data.status, parsed.data.notes));
  }),
);

adminRouter.get(
  "/table/:table",
  asyncHandler(async (req, res) => {
    const table = String(req.params.table);
    if (!isAllowedTable(table)) return fail(res, 400, `Table not allowed. Allowed: ${ADMIN_CRUD_TABLES.join(", ")}`);
    if (table === "sms_gateways") await seedSmsGateways();
    return listTable(res, tryServiceRole() ?? req.userClient!, table, req);
  }),
);

adminRouter.post(
  "/table/:table",
  asyncHandler(async (req, res) => {
    const table = String(req.params.table);
    if (!isAllowedTable(table)) return fail(res, 400, "Table not allowed");
    const row = req.body && typeof req.body === "object" ? req.body : {};
    const sb = tryServiceRole() ?? req.userClient!;
    if (table === "app_settings" && typeof (row as { key?: string }).key === "string") {
      const { data, error } = await sb
        .from(table)
        .upsert(
          { ...row, updated_at: new Date().toISOString() },
          { onConflict: "key" },
        )
        .select("*")
        .single();
      if (error) return fail(res, 400, error.message);
      return ok(res, { row: data });
    }
    const { data, error } = await sb.from(table).insert(row).select("*").single();
    if (error) {
      const { tableMissing, memTableInsert, memTableUpdate } = await import("../lib/memory.js");
      if (tableMissing(error)) {
        const body = row as Record<string, unknown>;
        const saved = body.id ? memTableUpdate(table, String(body.id), body) : memTableInsert(table, body);
        return ok(res, { row: saved, seeded: true });
      }
      return fail(res, 400, error.message);
    }
    return ok(res, { row: data });
  }),
);

adminRouter.patch(
  "/table/:table",
  asyncHandler(async (req, res) => {
    const table = String(req.params.table);
    if (!isAllowedTable(table)) return fail(res, 400, "Table not allowed");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = (typeof req.query.id === "string" ? req.query.id : body.id) as string | undefined;
    if (!id) return fail(res, 400, "id required");
    const { id: _id, ...patch } = body;
    const { data, error } = await req.userClient!
      .from(table)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) {
      const { tableMissing, memTableUpdate } = await import("../lib/memory.js");
      if (tableMissing(error)) return ok(res, { row: memTableUpdate(table, id, patch), seeded: true });
      return fail(res, 400, error.message);
    }
    return ok(res, { row: data });
  }),
);

adminRouter.delete(
  "/table/:table",
  asyncHandler(async (req, res) => {
    const table = String(req.params.table);
    if (!isAllowedTable(table)) return fail(res, 400, "Table not allowed");
    const id = (typeof req.query.id === "string" ? req.query.id : (req.body as { id?: string })?.id) ?? "";
    if (!id) return fail(res, 400, "id required");
    const { error } = await req.userClient!.from(table).delete().eq("id", id);
    if (error) {
      const { tableMissing, memTableDelete } = await import("../lib/memory.js");
      if (tableMissing(error)) return ok(res, { deleted: memTableDelete(table, id), seeded: true });
      return fail(res, 400, error.message);
    }
    return ok(res, { deleted: id });
  }),
);
