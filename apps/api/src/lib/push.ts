import { SignJWT, importPKCS8 } from "jose";
import { z } from "zod";
import type { DbClient } from "./pg-client.js";
import { getServiceRoleClient } from "./supabase.js";

export const TestPushSchema = z.object({
  trigger_id: z.string().uuid(),
  user_id: z.string().uuid().optional(),
});

export const LeadPushSchema = z.object({
  vendor_id: z.string().uuid(),
  lead_id: z.string().uuid(),
});

export const StatusPushSchema = z.object({
  lead_id: z.string().uuid(),
  status_key: z.string().min(1).max(64),
  message: z.string().max(280).optional(),
});

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const pk = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(sa.token_uri || "https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(pk);
  const r = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!r.ok) throw new Error(`OAuth token exchange failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { access_token: string };
  return j.access_token;
}

async function sendOne(opts: {
  projectId: string;
  accessToken: string;
  token: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  iconUrl?: string | null;
  actionUrl?: string | null;
  highPriority?: boolean;
  extraData?: Record<string, string>;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const isHigh = !!opts.highPriority;
  const message: Record<string, unknown> = {
    token: opts.token,
    android: {
      priority: isHigh ? "HIGH" : "NORMAL",
      ttl: isHigh ? "60s" : "3600s",
      notification: {
        channel_id: isHigh ? "lead_alerts_v2" : "default",
        sound: isHigh ? "lead_ring" : "default",
        notification_priority: isHigh ? "PRIORITY_MAX" : "PRIORITY_DEFAULT",
        default_vibrate_timings: !isHigh,
        default_light_settings: true,
        visibility: "PUBLIC",
        ...(opts.imageUrl ? { image: opts.imageUrl } : {}),
      },
    },
    apns: {
      headers: { "apns-priority": isHigh ? "10" : "5" },
      payload: {
        aps: {
          sound: isHigh ? "lead_ring.caf" : "default",
          "interruption-level": isHigh ? "time-sensitive" : "active",
          "mutable-content": 1,
          "content-available": 1,
        },
        ...(opts.imageUrl ? { "image-url": opts.imageUrl } : {}),
      },
      ...(opts.imageUrl ? { fcm_options: { image: opts.imageUrl } } : {}),
    },
    webpush: {
      headers: { Urgency: isHigh ? "high" : "normal", TTL: isHigh ? "60" : "3600" },
      fcm_options: { link: opts.actionUrl || "/" },
      notification: {
        title: opts.title,
        body: opts.body,
        requireInteraction: isHigh,
        renotify: true,
        silent: false,
        vibrate: isHigh ? [400, 150, 400, 150, 800] : [200, 100, 200],
        ...(opts.iconUrl ? { icon: opts.iconUrl } : {}),
        ...(opts.imageUrl ? { image: opts.imageUrl } : {}),
      },
    },
    data: {
      title: opts.title,
      body: opts.body,
      ...(opts.actionUrl ? { action_url: opts.actionUrl } : {}),
      ...(opts.imageUrl ? { image: opts.imageUrl } : {}),
      ...(opts.iconUrl ? { icon: opts.iconUrl } : {}),
      ...(opts.extraData ?? {}),
    },
    notification: {
      title: opts.title,
      body: opts.body,
      ...(opts.imageUrl ? { image: opts.imageUrl } : {}),
    },
  };
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${opts.projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  if (r.ok) return { ok: true, status: r.status };
  const txt = await r.text();
  return { ok: false, status: r.status, error: txt };
}

export async function pushToUser(opts: {
  userId: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  iconUrl?: string | null;
  actionUrl?: string | null;
  highPriority?: boolean;
  extraData?: Record<string, string>;
  campaignId?: string;
}) {
  const admin = getServiceRoleClient();
  const [{ data: fcm }, { data: tokens }] = await Promise.all([
    admin.from("firebase_services").select("project_id, service_account_json").eq("service_key", "fcm").maybeSingle(),
    admin.from("device_tokens").select("token, platform").eq("user_id", opts.userId).eq("is_active", true),
  ]);
  if (!fcm?.project_id || !fcm?.service_account_json) return { ok: false, reason: "fcm_not_configured" as const };
  const list = (tokens ?? [])
    .map((t) => ({ token: t.token as string, platform: String(t.platform ?? "unknown") }))
    .filter((t) => t.token);
  if (list.length === 0) return { ok: false, reason: "no_device_tokens" as const };

  let sa: ServiceAccount;
  try {
    sa = typeof fcm.service_account_json === "string" ? JSON.parse(fcm.service_account_json) : (fcm.service_account_json as ServiceAccount);
  } catch {
    return { ok: false, reason: "service_account_invalid" as const };
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(sa);
  } catch (e) {
    return { ok: false, reason: "oauth_failed" as const, error: String((e as Error)?.message ?? e) };
  }

  let okCount = 0;
  const results: Array<{ token: string; platform: string; ok: boolean; status: number; error?: string }> = [];
  for (const tk of list) {
    const r = await sendOne({
      projectId: fcm.project_id,
      accessToken,
      token: tk.token,
      title: opts.title,
      body: opts.body,
      imageUrl: opts.imageUrl,
      iconUrl: opts.iconUrl,
      actionUrl: opts.actionUrl,
      highPriority: opts.highPriority,
      extraData: opts.extraData,
    });
    if (r.ok) okCount += 1;
    results.push({ token: tk.token, platform: tk.platform, ...r });
    await admin.from("notification_logs").insert({
      user_id: opts.userId,
      device_token: tk.token,
      provider: "fcm",
      channel: "push",
      campaign_id: opts.campaignId ?? null,
      status: r.ok ? "delivered" : "failed",
      error: r.ok ? null : (r.error ?? `http_${r.status}`).slice(0, 500),
      payload: {
        title: opts.title,
        body: opts.body,
        action_url: opts.actionUrl ?? null,
        kind: opts.extraData?.kind ?? null,
      },
    }).then(() => null, () => null);
    if (!r.ok && (r.status === 404 || r.status === 400)) {
      await admin.from("device_tokens").update({ is_active: false }).eq("token", tk.token);
    }
  }
  const platformCounts = results.reduce<Record<string, number>>((acc, r) => {
    if (r.ok) acc[r.platform] = (acc[r.platform] ?? 0) + 1;
    return acc;
  }, {});
  return { ok: okCount > 0, sent: okCount, total: list.length, platformCounts, results };
}

export async function sendLeadPushToVendorInternal(data: { vendor_id: string; lead_id: string }) {
  const admin = getServiceRoleClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, sub_category_id, sub_category_name, customer_id, customer_name, customer_phone, address, images, lat, lng")
    .eq("id", data.lead_id)
    .maybeSingle();
  if (!lead) return { ok: false, reason: "lead_not_found" as const };

  const { data: notif } = await admin
    .from("lead_notifications")
    .select("id")
    .eq("lead_id", data.lead_id)
    .eq("vendor_id", data.vendor_id)
    .maybeSingle();
  if (!notif) return { ok: false, reason: "vendor_not_targeted" as const };

  const [{ data: cust }, { data: cat }] = await Promise.all([
    lead.customer_id
      ? admin.from("customers").select("avatar_url").eq("user_id", lead.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    lead.sub_category_id
      ? admin.from("categories").select("image_url, icon").eq("id", lead.sub_category_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const customerAvatar = cust?.avatar_url ?? null;
  const subCatImage = cat?.image_url ?? cat?.icon ?? null;
  const firstLeadImage = ((lead.images ?? []) as string[])[0] ?? null;
  const heroImage = firstLeadImage || subCatImage || null;
  const iconUrl = customerAvatar || subCatImage || null;

  const last4 = lead.customer_phone ? String(lead.customer_phone).replace(/\D/g, "").slice(-4) : "";
  const body = `${lead.customer_name ?? "Customer"} • ${lead.sub_category_name}${last4 ? ` • •••• ${last4}` : ""}`;
  return pushToUser({
    userId: data.vendor_id,
    title: "🔔 New Lead — 15s to respond",
    body,
    imageUrl: heroImage,
    iconUrl,
    actionUrl: `/vendor/dashboard?leadId=${lead.id}`,
    highPriority: true,
    extraData: {
      kind: "lead_alert",
      lead_id: lead.id as string,
      ...(iconUrl ? { icon: iconUrl } : {}),
      ...(heroImage ? { image: heroImage } : {}),
    },
  });
}

export async function sendTestPush(
  callerId: string,
  userSb: DbClient,
  data: z.infer<typeof TestPushSchema>,
) {
  const admin = getServiceRoleClient();
  const { data: isAdmin } = await userSb.rpc("is_admin_user", { _user_id: callerId });
  if (!isAdmin) throw new Error("Forbidden");

  const targetUser = data.user_id || callerId;
  const [{ data: trig }, { data: fcm }, { data: tokens }] = await Promise.all([
    admin.from("notification_triggers").select("*").eq("id", data.trigger_id).maybeSingle(),
    admin.from("firebase_services").select("project_id, service_account_json").eq("service_key", "fcm").maybeSingle(),
    admin.from("device_tokens").select("token, platform").eq("user_id", targetUser).eq("is_active", true),
  ]);

  if (!trig) return { ok: false, reason: "trigger_not_found" as const };
  if (!fcm?.project_id || !fcm?.service_account_json) {
    return { ok: false, reason: "fcm_not_configured" as const };
  }
  const list = (tokens ?? [])
    .map((t) => ({ token: t.token as string, platform: String(t.platform ?? "unknown") }))
    .filter((t) => t.token);
  if (list.length === 0) return { ok: false, reason: "no_device_tokens" as const, hint: "Open the app and Allow notifications first." };

  let sa: ServiceAccount;
  try {
    sa = typeof fcm.service_account_json === "string" ? JSON.parse(fcm.service_account_json) : (fcm.service_account_json as ServiceAccount);
  } catch {
    return { ok: false, reason: "service_account_invalid" as const };
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(sa);
  } catch (e) {
    return { ok: false, reason: "oauth_failed" as const, error: String((e as Error)?.message ?? e) };
  }

  const results: Array<{ ok: boolean; status: number; error?: string; token: string; platform: string }> = [];
  for (const tk of list) {
    const r = await sendOne({
      projectId: fcm.project_id,
      accessToken,
      token: tk.token,
      title: trig.title,
      body: trig.body,
      imageUrl: trig.image_url,
      actionUrl: trig.action_url,
      highPriority: true,
      extraData: { kind: "direct_test" },
    });
    results.push({ ...r, token: tk.token, platform: tk.platform });
    await admin.from("notification_logs").insert({
      trigger_id: data.trigger_id,
      user_id: targetUser,
      device_token: tk.token,
      provider: "fcm",
      channel: "push",
      status: r.ok ? "delivered" : "failed",
      error: r.ok ? null : r.error?.slice(0, 500),
      payload: { title: trig.title, body: trig.body, test: true, kind: "direct_test" },
    });
    if (!r.ok && (r.status === 404 || r.status === 400)) {
      await admin.from("device_tokens").update({ is_active: false }).eq("token", tk.token);
    }
  }

  await admin.from("notification_triggers").update({ last_fired_at: new Date().toISOString() }).eq("id", data.trigger_id);
  const okCount = results.filter((r) => r.ok).length;
  const platformCounts = results.reduce<Record<string, number>>((acc, r) => {
    if (r.ok) acc[r.platform] = (acc[r.platform] ?? 0) + 1;
    return acc;
  }, {});
  return { ok: okCount > 0, sent: okCount, failed: results.length - okCount, platformCounts, results };
}

export async function sendLeadPushToVendor(
  callerId: string,
  userSb: DbClient,
  data: z.infer<typeof LeadPushSchema>,
) {
  const admin = getServiceRoleClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, customer_id")
    .eq("id", data.lead_id)
    .maybeSingle();
  if (!lead) return { ok: false, reason: "lead_not_found" as const };

  const isCustomer = lead.customer_id === callerId;
  let isAdmin = false;
  if (!isCustomer) {
    const { data: adminFlag } = await userSb.rpc("is_admin_user", { _user_id: callerId });
    isAdmin = !!adminFlag;
  }
  if (!isCustomer && !isAdmin) {
    return { ok: false, reason: "not_authorized" as const };
  }
  return sendLeadPushToVendorInternal(data);
}

export async function sendStatusPushToCustomer(userId: string, data: z.infer<typeof StatusPushSchema>) {
  const admin = getServiceRoleClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, customer_id, sub_category_name, accepted_vendor_ids")
    .eq("id", data.lead_id)
    .maybeSingle();
  if (!lead) return { ok: false, reason: "lead_not_found" as const };
  if (!((lead.accepted_vendor_ids ?? []) as string[]).includes(userId)) {
    return { ok: false, reason: "not_accepted_vendor" as const };
  }

  const { data: vendor } = await admin.from("vendors").select("business_name, owner_name").eq("user_id", userId).maybeSingle();
  const vendorName = vendor?.business_name || vendor?.owner_name || "Your vendor";

  await admin.from("vendor_status_updates").insert({
    lead_id: data.lead_id,
    vendor_id: userId,
    status_key: data.status_key,
    message: data.message ?? null,
  }).then(() => null, () => null);

  const labels: Record<string, string> = {
    on_the_way: "🚗 Vendor is on the way",
    arrived: "📍 Vendor has arrived",
    working: "🛠️ Vendor started the work",
    completed: "✅ Vendor marked job complete",
  };
  const title = labels[data.status_key] ?? "Vendor update";
  const body = data.message || `${vendorName} • ${lead.sub_category_name}`;
  return pushToUser({
    userId: lead.customer_id,
    title,
    body,
    actionUrl: `/status?leadId=${lead.id}`,
    highPriority: true,
    extraData: { kind: "vendor_status", lead_id: lead.id as string, status_key: data.status_key },
  });
}
