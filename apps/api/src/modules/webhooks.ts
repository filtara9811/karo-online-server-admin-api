import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { env, hasServiceRole } from "../config/env.js";
import { getServiceRoleClient, tryServiceRole } from "../lib/supabase.js";
import { sendLeadPushToVendorInternal } from "../lib/push.js";
import { resolveShopIdentity } from "../lib/shops.js";
import { asyncHandler, fail, ok, serviceUnavailable, zodFail } from "../lib/respond.js";

export const webhooksRouter = Router();

function digitsOnly(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.length === 10 ? `91${d}` : d;
}

async function authorizeLeadVendors(req: Request, leadId: string, vendorIds: string[]): Promise<boolean> {
  const expected = env.internalHookSecret;
  const auth = req.headers.authorization ?? "";
  if (expected && auth === `Bearer ${expected}`) return true;
  if (!hasServiceRole()) return false;
  const admin = getServiceRoleClient();
  const { data: lead } = await admin.from("leads").select("id,status").eq("id", leadId).maybeSingle();
  const status = lead?.status as string | undefined;
  if (!lead || (status !== "new" && status !== "notifying")) return false;
  if (vendorIds.length === 0) return false;
  const { data: notifs } = await admin.from("lead_notifications").select("vendor_id").eq("lead_id", leadId).in("vendor_id", vendorIds);
  const known = new Set((notifs ?? []).map((r) => r.vendor_id));
  return vendorIds.every((v) => known.has(v));
}

type ProviderRow = {
  id: string;
  provider: string;
  webhook_verify_token: string | null;
  app_secret: string | null;
};

async function loadProviders(): Promise<ProviderRow[]> {
  const admin = tryServiceRole();
  if (!admin) return [];
  const { data } = await admin
    .from("whatsapp_providers")
    .select("id,provider,webhook_verify_token,app_secret")
    .in("provider", ["meta_cloud", "fast2sms_meta"]);
  return (data ?? []) as ProviderRow[];
}

function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const got = header.slice(7);
  try {
    const a = Buffer.from(got, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function parseButtonPayload(id: string): { leadId: string; action: "accept" | "reject" } | null {
  const m = /^lead:([0-9a-f-]{36}):(accept|reject)$/i.exec(id || "");
  if (!m) return null;
  return { leadId: m[1], action: m[2].toLowerCase() as "accept" | "reject" };
}

async function resolveVendorByPhone(phone: string): Promise<string | null> {
  const admin = getServiceRoleClient();
  const d = (phone || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const last10 = d.slice(-10);
  const { data } = await admin
    .from("vendors")
    .select("user_id,whatsapp,phone")
    .or(`whatsapp.ilike.%${last10},phone.ilike.%${last10}`)
    .limit(1);
  return data?.[0]?.user_id ?? null;
}

async function handleInteractive(msg: Record<string, unknown>, fromPhone: string) {
  const interactive = msg.interactive as { button_reply?: { id?: string }; list_reply?: { id?: string } } | undefined;
  const reply = interactive?.button_reply ?? interactive?.list_reply;
  if (!reply?.id) return;
  const parsed = parseButtonPayload(reply.id);
  if (!parsed) return;
  const vendorId = await resolveVendorByPhone(fromPhone);
  const admin = getServiceRoleClient();
  await admin.from("whatsapp_message_logs").insert({
    lead_id: parsed.leadId,
    vendor_id: vendorId,
    wa_message_id: (msg.id as string) ?? null,
    to_phone: fromPhone,
    status: "button_clicked",
    button_clicked: parsed.action,
    clicked_at: new Date().toISOString(),
  });
  if (!vendorId) return;
  if (parsed.action === "accept") {
    await admin.rpc("accept_lead_for_vendor", { _lead_id: parsed.leadId, _vendor_id: vendorId });
  } else {
    await admin.rpc("reject_lead_for_vendor", {
      _lead_id: parsed.leadId,
      _vendor_id: vendorId,
      _reason: "rejected_via_whatsapp",
    });
  }
}

webhooksRouter.get("/whatsapp/webhook", async (req, res) => {
  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");
  if (mode !== "subscribe" || !token || !challenge) {
    res.status(400).send("bad_request");
    return;
  }
  if (!hasServiceRole()) {
    res.status(503).send("SUPABASE_SERVICE_ROLE_KEY missing");
    return;
  }
  const providers = await loadProviders();
  const verified = providers.some((p) => p.webhook_verify_token && p.webhook_verify_token === token);
  if (!verified) {
    res.status(403).send("forbidden");
    return;
  }
  res.status(200).type("text/plain").send(challenge);
});

webhooksRouter.post("/whatsapp/webhook", async (req, res) => {
  if (!hasServiceRole()) {
    res.status(503).send("SUPABASE_SERVICE_ROLE_KEY missing");
    return;
  }
  const raw =
    (req as Request & { rawBody?: string }).rawBody ??
    (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
  const sigHeader = (req.headers["x-hub-signature-256"] as string | undefined) ?? null;
  const providers = await loadProviders();
  const secretCandidates = providers.map((p) => p.app_secret).filter((s): s is string => !!s);
  if (secretCandidates.length === 0) {
    res.status(401).send("webhook_not_configured");
    return;
  }
  const signatureOk = secretCandidates.some((s) => verifySignature(raw, sigHeader, s));
  if (!signatureOk) {
    res.status(401).send("invalid_signature");
    return;
  }
  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
        for (const msg of messages) {
          if (msg?.type === "interactive") await handleInteractive(msg, msg?.from ?? "");
        }
      }
    }
  } catch (e) {
    console.error("[wa-webhook] processing_error", (e as Error)?.message ?? e);
  }
  res.status(200).send("ok");
});

const SendLeadSchema = z.object({
  lead_id: z.string().uuid(),
  vendor_ids: z.array(z.string().uuid()).default([]),
  template_name: z.string().optional(),
  language: z.string().optional(),
});

type MetaProvider = {
  id: string;
  provider: string;
  api_base_url: string | null;
  phone_number_id: string | null;
  access_token: string | null;
  default_template: string | null;
  is_active: boolean;
  is_test_mode: boolean;
};

async function loadActiveMetaProvider(): Promise<MetaProvider | null> {
  const admin = getServiceRoleClient();
  const { data } = await admin
    .from("whatsapp_providers")
    .select("id,provider,api_base_url,phone_number_id,access_token,default_template,is_active,is_test_mode,priority")
    .in("provider", ["fast2sms_meta", "meta_cloud"])
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(1);
  return ((data ?? [])[0] as MetaProvider | undefined) ?? null;
}

function buildProviderUrl(provider: MetaProvider) {
  const base = (provider.api_base_url || "https://graph.facebook.com/v20.0").replace(/\/$/, "");
  if (provider.provider === "fast2sms_meta") {
    const versioned = /\/v\d+\.\d+$/i.test(base) ? base : `${base}/v24.0`;
    return `${versioned}/${provider.phone_number_id}/messages`;
  }
  return `${base}/${provider.phone_number_id}/messages`;
}

webhooksRouter.post(
  "/whatsapp/send-lead",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = SendLeadSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    if (!(await authorizeLeadVendors(req, parsed.data.lead_id, parsed.data.vendor_ids))) {
      return fail(res, 401, "unauthorized");
    }

    let pushSent = 0;
    try {
      for (const vendorId of parsed.data.vendor_ids) {
        const r = await sendLeadPushToVendorInternal({ vendor_id: vendorId, lead_id: parsed.data.lead_id });
        if (r?.ok) pushSent += 1;
      }
    } catch (e) {
      console.warn("[lead-push] server fallback failed", e);
    }

    const provider = await loadActiveMetaProvider();
    if (!provider || !provider.access_token || !provider.phone_number_id) {
      return ok(res, { pushSent, skipped: "meta_not_configured" });
    }

    const admin = getServiceRoleClient();
    const [{ data: lead }, { data: vendors }] = await Promise.all([
      admin.from("leads").select("id,description,city,sub_category_name,image_url,budget").eq("id", parsed.data.lead_id).maybeSingle(),
      admin.from("vendors").select("user_id,owner_name,business_name,whatsapp").in("user_id", parsed.data.vendor_ids),
    ]);
    if (!lead) return fail(res, 404, "lead_not_found");

    const templateName = parsed.data.template_name || provider.default_template || "lead_notification_v1";
    const language = parsed.data.language || "hi";
    let sent = 0;
    const errors: string[] = [];

    for (const v of vendors ?? []) {
      const phone = digitsOnly(v.whatsapp);
      if (!phone) continue;
      const components: unknown[] = [];
      if (lead.image_url) {
        components.push({ type: "header", parameters: [{ type: "image", image: { link: lead.image_url } }] });
      }
      components.push({
        type: "body",
        parameters: [
          { type: "text", text: v.business_name || v.owner_name || "Vendor" },
          { type: "text", text: lead.sub_category_name || "Service" },
          { type: "text", text: lead.city || "—" },
          { type: "text", text: String(lead.description || "New lead").slice(0, 120) },
        ],
      });
      components.push({
        type: "button",
        sub_type: "quick_reply",
        index: "0",
        parameters: [{ type: "payload", payload: `lead:${parsed.data.lead_id}:accept` }],
      });
      components.push({
        type: "button",
        sub_type: "quick_reply",
        index: "1",
        parameters: [{ type: "payload", payload: `lead:${parsed.data.lead_id}:reject` }],
      });
      try {
        const r = await fetch(buildProviderUrl(provider), {
          method: "POST",
          headers: {
            Authorization: provider.provider === "fast2sms_meta" ? provider.access_token || "" : `Bearer ${provider.access_token}`,
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: phone,
            type: "template",
            template: { name: templateName, language: { code: language }, components },
          }),
        });
        const json = (await r.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
        const resultOk = r.ok;
        await admin.from("whatsapp_message_logs").insert({
          lead_id: parsed.data.lead_id,
          vendor_id: v.user_id,
          provider_id: provider.id,
          wa_message_id: json?.messages?.[0]?.id ?? null,
          to_phone: phone,
          template_name: templateName,
          status: resultOk ? "sent" : "failed",
          error_payload: resultOk ? null : { error: `${r.status}:${json?.error?.message || "send_failed"}` },
        });
        if (resultOk) sent += 1;
        else errors.push(`${v.user_id}:${r.status}`);
      } catch (e) {
        errors.push(`${v.user_id}:${(e as Error).message}`);
      }
    }

    return ok(res, { pushSent, sent, total: (vendors ?? []).length, template: templateName, errors: errors.slice(0, 5) });
  }),
);

const HookSchema = z.object({
  lead_id: z.string().uuid(),
  vendor_ids: z.array(z.string().uuid()).default([]),
  batch_no: z.number().int().optional(),
});

webhooksRouter.post(
  "/hooks/lead-whatsapp",
  asyncHandler(async (req, res) => {
    const parsed = HookSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    if (!hasServiceRole()) return serviceUnavailable(res);
    if (!(await authorizeLeadVendors(req, parsed.data.lead_id, parsed.data.vendor_ids))) {
      return fail(res, 401, "unauthorized");
    }
    const lovableKey = env.lovableApiKey;
    const gwKey = env.gatewayApiKey;
    if (!lovableKey || !gwKey) return ok(res, { skipped: "gatewayapi_not_configured" });

    const admin = getServiceRoleClient();
    const { data } = await admin
      .from("vendors")
      .select("user_id,owner_name,business_name,whatsapp")
      .in("user_id", parsed.data.vendor_ids);
    const recipients: { vendor_id: string; phone: string; name: string | null }[] = [];
    for (const v of data ?? []) {
      const phone = digitsOnly(v.whatsapp);
      if (phone) recipients.push({ vendor_id: v.user_id, phone, name: v.business_name || v.owner_name || null });
    }
    if (recipients.length === 0) return ok(res, { sent: 0 });

    let sent = 0;
    const errors: string[] = [];
    for (const r of recipients) {
      const message = `Karoonline · New Lead\n${r.name ? `Hi ${r.name},\n` : ""}You've received a new lead request. Please open the Karoonline vendor app to accept it within 30 seconds.\n\nLead Ref: ${parsed.data.lead_id.slice(0, 8)}`;
      try {
        const resGw = await fetch("https://connector-gateway.lovable.dev/gatewayapi/mobile/single", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            "X-Connection-Api-Key": gwKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sender: "Karoonline",
            recipient: Number(r.phone),
            message,
            reference: `lead-${parsed.data.lead_id}-${r.vendor_id.slice(0, 6)}`,
          }),
        });
        if (resGw.ok) sent += 1;
        else errors.push(`${r.vendor_id}:${resGw.status}`);
      } catch (e) {
        errors.push(`${r.vendor_id}:${(e as Error).message}`);
      }
    }
    return ok(res, { sent, total: recipients.length, errors: errors.slice(0, 5) });
  }),
);

const PushLeadSchema = z.object({
  lead_id: z.string().uuid(),
  vendor_ids: z.array(z.string().uuid()).default([]),
});

webhooksRouter.post(
  "/push/send-lead",
  asyncHandler(async (req, res) => {
    if (!hasServiceRole()) return serviceUnavailable(res);
    const parsed = PushLeadSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    if (!(await authorizeLeadVendors(req, parsed.data.lead_id, parsed.data.vendor_ids))) {
      return fail(res, 401, "unauthorized");
    }
    let sent = 0;
    const results: Array<{ vendor_id: string; ok: boolean; reason?: string }> = [];
    for (const vendorId of parsed.data.vendor_ids) {
      const result = await sendLeadPushToVendorInternal({ vendor_id: vendorId, lead_id: parsed.data.lead_id });
      const succeeded = !!result?.ok;
      if (succeeded) sent += 1;
      results.push({
        vendor_id: vendorId,
        ok: succeeded,
        reason: (result as { reason?: string; error?: string })?.reason ?? (result as { error?: string })?.error,
      });
    }
    return ok(res, { sent, total: parsed.data.vendor_ids.length, results: results.slice(0, 20) });
  }),
);

const ShipSchema = z.object({
  awb: z.string().min(3).max(64).optional(),
  order_id: z.string().min(1).max(64).optional(),
  current_status: z.string().min(2).max(64),
  courier_name: z.string().max(80).optional(),
  scan_detail: z.string().max(500).optional(),
});

const SHIP_MAP: Record<string, string> = {
  "pickup scheduled": "packed",
  "pickup generated": "packed",
  "picked up": "shipped",
  shipped: "shipped",
  "in transit": "shipped",
  "out for delivery": "out_for_delivery",
  delivered: "delivered",
  canceled: "cancelled",
  cancelled: "cancelled",
};

webhooksRouter.post("/shiprocket-webhook", async (req, res) => {
  if (!hasServiceRole()) {
    res.status(503).send("SUPABASE_SERVICE_ROLE_KEY missing");
    return;
  }
  const admin = getServiceRoleClient();
  const { data: gw } = await admin.from("logistics_gateways").select("config").eq("provider", "shiprocket").maybeSingle();
  const expected = ((gw?.config as { webhook_token?: string } | null) ?? {}).webhook_token;
  const got = String(req.headers["x-api-key"] ?? "");
  if (!expected || got !== expected) {
    res.status(401).send("Unauthorized");
    return;
  }
  const parsed = ShipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).send("Bad payload");
    return;
  }
  const status = SHIP_MAP[parsed.data.current_status.trim().toLowerCase()];
  if (!status) {
    res.status(202).send("ignored");
    return;
  }
  let query = admin.from("shop_threads").select("id").limit(1);
  query = parsed.data.awb ? query.eq("awb_number", parsed.data.awb) : query.eq("order_code", parsed.data.order_id ?? "");
  const { data: thread } = await query.maybeSingle();
  if (!thread) {
    res.status(404).send("Unknown shipment");
    return;
  }
  const stamp: Record<string, string> = {
    packed: "packed_at",
    shipped: "shipped_at",
    out_for_delivery: "out_for_delivery_at",
    delivered: "delivered_at",
    cancelled: "cancelled_at",
  };
  await admin
    .from("shop_threads")
    .update({
      status,
      [stamp[status] as string]: new Date().toISOString(),
      ...(parsed.data.courier_name ? { courier_name: parsed.data.courier_name } : {}),
      last_message_at: new Date().toISOString(),
    })
    .eq("id", thread.id);
  await admin.from("shop_order_events").insert({
    thread_id: thread.id,
    status,
    note: parsed.data.scan_detail ?? null,
    actor: "courier",
  });
  res.status(200).send("ok");
});

webhooksRouter.get("/manifest/:code", async (req, res) => {
  const code = String(req.params.code || "").slice(0, 64);
  if (!code) {
    res.status(404).send("not found");
    return;
  }
  if (!hasServiceRole()) {
    res.status(503).json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY missing" });
    return;
  }
  const project = typeof req.query.p === "string" ? req.query.p : null;
  const accentParam = typeof req.query.accent === "string" ? req.query.accent : "";
  const id = await resolveShopIdentity(code, project);
  const name = id.name || "Karo Shop";
  const accentCandidate = accentParam || id.accent || "";
  const accent = /^#[0-9a-fA-F]{6}$/.test(accentCandidate) ? accentCandidate : "#f59e0b";
  const q = project ? `?p=${encodeURIComponent(project)}` : "";
  const start = `/s/${encodeURIComponent(code)}${q}`;
  const iconUrl = (size: number) =>
    `/api/public/shop-icon/${encodeURIComponent(code)}?size=${size}` + (project ? `&p=${encodeURIComponent(project)}` : "");
  const icons = id.icon
    ? [
        { src: iconUrl(192), sizes: "192x192", type: "image/png", purpose: "any" },
        { src: iconUrl(192), sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: iconUrl(512), sizes: "512x512", type: "image/png", purpose: "any" },
        { src: iconUrl(512), sizes: "512x512", type: "image/png", purpose: "maskable" },
      ]
    : [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ];
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    name,
    short_name: (name || "Shop").trim().slice(0, 12) || "Shop",
    id: `/s/${encodeURIComponent(code)}/`,
    start_url: start,
    scope: `/s/${encodeURIComponent(code)}`,
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: accent,
    description: `${name} — digital shop on Karo Online`,
    icons,
    prefer_related_applications: false,
  });
});

webhooksRouter.get("/shop-icon/:code", async (req, res) => {
  const code = String(req.params.code || "").slice(0, 64);
  const fallback = () => res.redirect(302, "/icon-512.png");
  if (!code || !hasServiceRole()) return fallback();
  const project = typeof req.query.p === "string" ? req.query.p : null;
  const { icon } = await resolveShopIdentity(code, project);
  if (!icon || !/^https?:\/\//i.test(icon)) return fallback();
  try {
    const upstream = await fetch(icon);
    if (!upstream.ok || !upstream.body) return fallback();
    const type = upstream.headers.get("content-type") ?? "";
    res.setHeader("Content-Type", /^image\//i.test(type) ? type : "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(200).end(buf);
  } catch {
    fallback();
  }
});

webhooksRouter.get("/vcard/:code", async (req, res) => {
  const code = String(req.params.code || "").slice(0, 64);
  if (!code) {
    res.status(404).send("not found");
    return;
  }
  if (!hasServiceRole()) {
    res.status(503).send("SUPABASE_SERVICE_ROLE_KEY missing");
    return;
  }
  const admin = getServiceRoleClient();
  const { data } = await admin
    .from("customers")
    .select("name, phone, email, address, shop_name, card_link_url, avatar_url")
    .eq("referral_code", code)
    .maybeSingle();
  if (!data) {
    res.status(404).send("not found");
    return;
  }
  const esc = (s: string | null | undefined) =>
    String(s ?? "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
  const realEmail = (v?: string | null) => (v && !/^phone-\d+@auth\.karoonline\.local$/i.test(v) ? v : "");
  const fullName = data.name || data.shop_name || "Karo Online Contact";
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${esc(fullName)}`,
    `N:${esc(fullName)};;;;`,
    data.shop_name ? `ORG:${esc(data.shop_name)}` : "",
    data.phone ? `TEL;TYPE=CELL,VOICE:${esc(data.phone)}` : "",
    realEmail(data.email) ? `EMAIL;TYPE=INTERNET:${esc(realEmail(data.email))}` : "",
    data.address ? `ADR;TYPE=WORK:;;${esc(data.address)};;;;` : "",
    data.card_link_url ? `URL:${esc(data.card_link_url)}` : "",
    `NOTE:${esc("Saved from KaroOnline · Digital Business Card")}`,
    "END:VCARD",
  ].filter(Boolean);
  res.setHeader("Content-Type", "text/vcard; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${code}.vcf"`);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).send(lines.join("\r\n"));
});

const VendorLocSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  is_online: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === "true" || v === "1")),
});

async function vendorLocation(req: Request, res: Response) {
  if (!hasServiceRole()) return serviceUnavailable(res);
  const admin = getServiceRoleClient();
  const auth = req.headers.authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail(res, 401, "missing_token");
  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u?.user) return fail(res, 401, "invalid_token");
  const parsed = VendorLocSchema.safeParse(req.method === "GET" ? req.query : req.body);
  if (!parsed.success) return zodFail(res, parsed.error);
  const { error: upErr } = await admin
    .from("vendors")
    .update({
      live_lat: parsed.data.lat,
      live_lng: parsed.data.lng,
      location_updated_at: new Date().toISOString(),
      ...(typeof parsed.data.is_online === "boolean" ? { is_online: parsed.data.is_online } : {}),
    })
    .eq("user_id", u.user.id);
  if (upErr) return fail(res, 500, upErr.message);
  return ok(res);
}

webhooksRouter.get("/vendor-location", asyncHandler(vendorLocation));
webhooksRouter.post("/vendor-location", asyncHandler(vendorLocation));
