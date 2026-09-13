import { z } from "zod";
import { getServiceRoleClient, createAnonClient } from "./supabase.js";
import { kmBetween } from "./geo.js";

export const NearbyShopsSchema = z.object({
  origin: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  radiusKm: z.number().min(0).max(50).optional(),
});

export async function getNearbyDigitalShops(data: z.infer<typeof NearbyShopsSchema>) {
  const admin = getServiceRoleClient();
  const { data: rows, error } = await admin
    .from("vendors")
    .select(
      "id, business_name, owner_name, trade, deals_in, avatar_url, profile_photo_url, cover_image_url, cover_video_url, verified, is_online, status, is_blocked, lat, lng, live_lat, live_lng, location_updated_at, operation_mode, service_radius_km",
    )
    .eq("is_blocked", false)
    .eq("status", "active");

  if (error) {
    const { tableMissing, seedNearbyVendors } = await import("./memory.js");
    if (tableMissing(error)) {
      return {
        ok: true as const,
        shops: seedNearbyVendors(data.origin).map((v) => ({
          id: v.id,
          business_name: v.business_name,
          owner_name: v.owner_name,
          trade: null,
          deals_in: null,
          avatar_url: v.avatar_url,
          cover_image_url: v.cover_image_url,
          cover_video_url: null,
          verified: true,
          is_online: v.is_online,
          lat: v.lat,
          lng: v.lng,
          km: v.km,
          service_radius_km: v.service_radius_km,
        })),
        seeded: true,
      };
    }
    return { ok: false as const, error: error.message, shops: [] };
  }

  const origin = data.origin ?? null;
  const radiusKm = data.radiusKm ?? 25;
  const FRESH_MS = 24 * 60 * 60 * 1000;

  const shops = (rows ?? [])
    .map((v) => {
      const fresh = !!v.location_updated_at && Date.now() - new Date(v.location_updated_at).getTime() <= FRESH_MS;
      const useLive = v.operation_mode === "dynamic" && fresh && v.live_lat != null && v.live_lng != null;
      const rawLat = useLive ? v.live_lat : (v.lat ?? v.live_lat);
      const rawLng = useLive ? v.live_lng : (v.lng ?? v.live_lng);
      const lat = rawLat == null ? null : Number(rawLat);
      const lng = rawLng == null ? null : Number(rawLng);
      const km =
        origin && lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
          ? kmBetween(origin, { lat, lng })
          : null;
      return {
        id: String(v.id),
        business_name: v.business_name ?? null,
        owner_name: v.owner_name ?? null,
        trade: v.trade ?? null,
        deals_in: v.deals_in ?? null,
        avatar_url: v.profile_photo_url ?? v.avatar_url ?? null,
        cover_image_url: v.cover_image_url ?? null,
        cover_video_url: v.cover_video_url ?? null,
        verified: Boolean(v.verified),
        is_online: Boolean(v.is_online),
        lat,
        lng,
        km,
        service_radius_km: Number(v.service_radius_km ?? 10),
      };
    })
    .filter((s) => !origin || s.km == null || radiusKm === 0 || s.km <= radiusKm)
    .sort((a, b) => {
      if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
      return (a.km ?? 9999) - (b.km ?? 9999);
    })
    .slice(0, 30);

  return { ok: true as const, shops };
}

export async function fetchPublicLanding(code: string, project?: string | null, kind = "q") {
  const { publicLanding, tableMissing } = await import("./memory.js");
  const seeded = { ...publicLanding(kind, code), project: project ?? null };
  const client = createAnonClient();
  const { data, error } = await client.rpc("get_public_landing", {
    _code: code,
    _project: project ?? undefined,
  });
  if (error) {
    if (tableMissing(error)) return seeded;
    return { ok: false, error: error.message };
  }
  const row = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (row.ok === false) return { ok: false, error: typeof row.error === "string" ? row.error : "not found" };
  const name = typeof row.name === "string" && row.name ? row.name : seeded.name;
  const products = Array.isArray(row.products) && row.products.length ? row.products : seeded.products;
  return { ...seeded, ...row, ok: true, name, products, project: project ?? seeded.project ?? null };
}

export type ShopIdentity = {
  name: string | null;
  icon: string | null;
  accent: string | null;
};

export async function resolveShopIdentity(code: string, project: string | null): Promise<ShopIdentity> {
  const out: ShopIdentity = { name: null, icon: null, accent: null };
  try {
    const admin = getServiceRoleClient();
    let userId: string | null = null;
    const rc = await admin.from("referral_codes").select("user_id").ilike("code", code).maybeSingle();
    userId = rc.data?.user_id ?? null;

    let customer: {
      name: string | null;
      shop_name: string | null;
      avatar_url: string | null;
      shop_logo_url: string | null;
    } | null = null;

    if (userId) {
      const c = await admin
        .from("customers")
        .select("name, shop_name, avatar_url, shop_logo_url")
        .eq("id", userId)
        .maybeSingle();
      customer = c.data ?? null;
    } else {
      const c = await admin
        .from("customers")
        .select("id, name, shop_name, avatar_url, shop_logo_url")
        .ilike("referral_code", code)
        .maybeSingle();
      if (c.data) {
        userId = c.data.id;
        customer = c.data;
      }
    }

    if (customer) {
      out.name = customer.shop_name || customer.name || null;
      out.icon = customer.shop_logo_url || customer.avatar_url || null;
    }

    if (!out.name && userId) {
      const v = await admin.from("vendors").select("business_name, avatar_url").eq("user_id", userId).maybeSingle();
      out.name = out.name || v.data?.business_name || null;
      out.icon = out.icon || v.data?.avatar_url || null;
    }

    const PROJ_COLS = "business_name, title, avatar_url, accent_color";
    let proj: {
      business_name: string | null;
      title: string | null;
      avatar_url: string | null;
      accent_color: string | null;
    } | null = null;
    if (project) {
      const bySlug = await admin.from("qr_projects").select(PROJ_COLS).eq("slug", project).maybeSingle();
      proj = bySlug.data ?? null;
      if (!proj && /^[0-9a-f-]{36}$/i.test(project)) {
        const byId = await admin.from("qr_projects").select(PROJ_COLS).eq("id", project).maybeSingle();
        proj = byId.data ?? null;
      }
    }
    if (!proj && userId) {
      const first = await admin
        .from("qr_projects")
        .select(PROJ_COLS)
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      proj = first.data ?? null;
    }
    if (proj) {
      out.name = proj.business_name || proj.title || out.name;
      out.icon = proj.avatar_url || out.icon;
      out.accent = proj.accent_color ?? null;
    }
  } catch {
    /* defaults */
  }
  return out;
}
