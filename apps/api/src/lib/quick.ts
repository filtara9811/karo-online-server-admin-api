import { z } from "zod";
import { createAnonClient, getServiceRoleClient, tryServiceRole } from "./supabase.js";
import { kmBetween } from "./geo.js";

export const QuickVendorsSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(50),
  origin: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  radiusKm: z.number().min(0).max(50).optional(),
});

export const NearbyOnlineSchema = z.object({
  origin: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  radiusKm: z.number().min(0).max(50).optional(),
  subCategoryId: z.string().uuid().nullable().optional(),
  itemIds: z.array(z.string().uuid()).max(50).optional(),
});

export async function getQuickMapVendors(data: z.infer<typeof QuickVendorsSchema>) {
  const admin = getServiceRoleClient();
  const itemIds = Array.from(new Set(data.itemIds)).slice(0, 50);
  const { data: mappings, error: mappingsError } = await admin
    .from("vendor_item_mappings")
    .select("vendor_id")
    .in("item_id", itemIds)
    .eq("is_active", true);

  if (mappingsError) {
    const { tableMissing, seedNearbyVendors } = await import("./memory.js");
    if (tableMissing(mappingsError)) {
      return { ok: true as const, vendors: seedNearbyVendors(data.origin), seeded: true };
    }
    return { ok: false as const, error: mappingsError.message, vendors: [] };
  }

  const vendorIds = Array.from(new Set((mappings ?? []).map((m) => m.vendor_id).filter(Boolean)));
  if (vendorIds.length === 0) return { ok: true as const, vendors: [] };

  const { data: vendors, error: vendorsError } = await admin
    .from("vendors")
    .select("id, user_id, business_name, owner_name, avatar_url, profile_photo_url, cover_image_url, status, is_blocked, is_online, lat, lng, live_lat, live_lng, location_updated_at, operation_mode, service_radius_km")
    .in("user_id", vendorIds);

  if (vendorsError) {
    const { tableMissing, seedNearbyVendors } = await import("./memory.js");
    if (tableMissing(vendorsError)) {
      return { ok: true as const, vendors: seedNearbyVendors(data.origin), seeded: true };
    }
    return { ok: false as const, error: vendorsError.message, vendors: [] };
  }

  const origin = data.origin ?? null;
  const radiusKm = data.radiusKm ?? 10;
  if (!origin) return { ok: true as const, vendors: [] };

  const publicVendors = (vendors ?? [])
    .filter((v) => v.status === "active" && v.is_blocked === false)
    .map((v) => {
      const dynamic = v.operation_mode === "dynamic";
      const fresh = !!v.location_updated_at && Date.now() - new Date(v.location_updated_at).getTime() <= 10 * 60 * 1000;
      const useLive = dynamic && fresh && v.live_lat != null && v.live_lng != null;
      const rawLat = useLive ? v.live_lat : v.lat;
      const rawLng = useLive ? v.live_lng : v.lng;
      const lat = rawLat == null ? null : Number(rawLat);
      const lng = rawLng == null ? null : Number(rawLng);
      const km = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? kmBetween(origin, { lat, lng }) : null;
      return {
        id: String(v.id),
        user_id: String(v.user_id),
        business_name: v.business_name as string | null,
        owner_name: v.owner_name as string | null,
        avatar_url: (v.profile_photo_url ?? v.avatar_url) as string | null,
        cover_image_url: v.cover_image_url as string | null,
        status: v.status as string | null,
        is_online: Boolean(v.is_online),
        lat,
        lng,
        service_radius_km: Number(v.service_radius_km ?? 10),
        km,
      };
    })
    .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng) && v.km != null)
    .filter((v) => (radiusKm === 0 || (v.km ?? 9999) <= radiusKm) && (v.service_radius_km === 0 || (v.km ?? 9999) <= v.service_radius_km))
    .sort((a, b) => (a.km ?? 9999) - (b.km ?? 9999))
    .slice(0, 12);

  return { ok: true as const, vendors: publicVendors };
}

export async function getNearbyOnlineVendors(data: z.infer<typeof NearbyOnlineSchema>) {
  try {
    const admin = getServiceRoleClient();
    const itemIds = Array.from(new Set(data.itemIds ?? [])).slice(0, 50);
    let mappedVendorIds: string[] | null = null;

    if (itemIds.length || data.subCategoryId) {
      let query = admin
        .from("vendor_item_mappings")
        .select("vendor_id, catalog_items!inner(category_id)")
        .eq("is_active", true);
      if (itemIds.length) query = query.in("item_id", itemIds);
      if (data.subCategoryId) query = query.eq("catalog_items.category_id", data.subCategoryId);
      const { data: mappings, error: mappingsError } = await query;
      if (mappingsError) {
        const { tableMissing, seedNearbyVendors } = await import("./memory.js");
        if (tableMissing(mappingsError)) {
          const vendors = seedNearbyVendors(data.origin);
          return {
            ok: true as const,
            vendors,
            onlineCount: vendors.filter((v) => v.is_online).length,
            offlineCount: vendors.filter((v) => !v.is_online).length,
            seeded: true,
          };
        }
        return { ok: false as const, error: mappingsError.message, vendors: [], onlineCount: 0, offlineCount: 0 };
      }
      mappedVendorIds = Array.from(new Set((mappings ?? []).map((m) => String(m.vendor_id)).filter(Boolean)));
      if (mappedVendorIds.length === 0) mappedVendorIds = null;
    }

    const { data: vendors, error } = await admin
      .from("vendors")
      .select("id, user_id, business_name, owner_name, avatar_url, profile_photo_url, cover_image_url, status, is_blocked, is_online, lat, lng, live_lat, live_lng, location_updated_at, operation_mode, service_radius_km")
      .eq("is_blocked", false);

    if (error) {
      const { tableMissing, seedNearbyVendors } = await import("./memory.js");
      if (tableMissing(error)) {
        const vendors = seedNearbyVendors(data.origin);
        return { ok: true as const, vendors, onlineCount: vendors.filter((v) => v.is_online).length, offlineCount: vendors.filter((v) => !v.is_online).length, seeded: true };
      }
      return { ok: false as const, error: error.message, vendors: [], onlineCount: 0, offlineCount: 0 };
    }

    const origin = data.origin ?? null;
    const radiusKm = data.radiusKm ?? 10;
    const FRESH_MS = 24 * 60 * 60 * 1000;
    const publicVendors = (vendors ?? [])
      .filter((v) => !mappedVendorIds || mappedVendorIds.includes(String(v.user_id)) || mappedVendorIds.includes(String(v.id)))
      .map((v) => {
        const fresh = !!v.location_updated_at && Date.now() - new Date(v.location_updated_at).getTime() <= FRESH_MS;
        const useLive = fresh && v.live_lat != null && v.live_lng != null;
        const rawLat = useLive ? v.live_lat : (v.lat ?? v.live_lat);
        const rawLng = useLive ? v.live_lng : (v.lng ?? v.live_lng);
        const lat = rawLat == null ? null : Number(rawLat);
        const lng = rawLng == null ? null : Number(rawLng);
        const km =
          origin && lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
            ? kmBetween(origin, { lat, lng })
            : null;
        const isOnline = v.status === "active" && Boolean(v.is_online);
        return {
          id: String(v.id),
          user_id: String(v.user_id),
          business_name: v.business_name as string | null,
          owner_name: v.owner_name as string | null,
          avatar_url: (v.profile_photo_url ?? v.avatar_url ?? null) as string | null,
          cover_image_url: (v.cover_image_url ?? null) as string | null,
          status: v.status as string | null,
          is_online: isOnline,
          area: null as string | null,
          lat,
          lng,
          service_radius_km: Number(v.service_radius_km ?? 10),
          km,
        };
      })
      .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng) && (!origin || v.km != null))
      .filter((v) => !origin || radiusKm === 0 || (v.km ?? 9999) <= radiusKm)
      .sort((a, b) => {
        if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
        return (a.km ?? 9999) - (b.km ?? 9999);
      })
      .slice(0, 24);

    const onlineCount = publicVendors.filter((v) => v.is_online).length;
    return { ok: true as const, vendors: publicVendors, onlineCount, offlineCount: publicVendors.length - onlineCount };
  } catch (e) {
    console.error("[getNearbyOnlineVendors] failure:", (e as Error)?.message ?? e);
    return { ok: false as const, error: String((e as Error)?.message ?? e), vendors: [], onlineCount: 0, offlineCount: 0 };
  }
}

export async function getQuickCatalog() {
  const admin = tryServiceRole() ?? createAnonClient();
  const [categories, items, types] = await Promise.all([
    admin
      .from("categories")
      .select("id,name,slug,image_url,icon,parent_id,sort_order,keywords,type_id,is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("catalog_items")
      .select("id,name,category_id,image_url,keywords,group_tag,sort_order,is_active,price_min,price_max,slug")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("catalog_types")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);
  if (categories.error || items.error || types.error) {
    const { tableMissing, SEED_CATALOG } = await import("./memory.js");
    if (tableMissing(categories.error) || tableMissing(items.error) || tableMissing(types.error)) {
      return { ok: true as const, ...SEED_CATALOG, seeded: true };
    }
    return { ok: false as const, error: categories.error?.message ?? items.error?.message ?? types.error?.message };
  }
  return {
    ok: true as const,
    categories: categories.data ?? [],
    items: items.data ?? [],
    types: types.data ?? [],
  };
}
