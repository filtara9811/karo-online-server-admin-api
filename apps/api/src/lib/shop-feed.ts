import { env } from "../config/env.js";
import { tryServiceRole } from "./supabase.js";

export type FeedMedia = {
  type: "image" | "video" | "url";
  src: string;
  poster?: string | null;
  products?: FeedProduct[];
};

export type FeedProduct = {
  id: string;
  name: string;
  price?: string | null;
  mrp?: string | null;
  image?: string | null;
  cta?: { preset?: string | null; label?: string | null; color?: string | null; url?: string | null } | null;
};

export type VendorFeedRow = {
  slug: string;
  name: string;
  category: string | null;
  city: string | null;
  trade_type: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  contact_phone: string | null;
  code: string | null;
  shop_url: string | null;
  sponsored: boolean;
  created_at: string;
  latest_media: FeedMedia | null;
  latest_index: number;
  media_count: number;
  products: FeedProduct[];
  has_video: boolean;
  stats: { views: number; likes: number; comments: number; shares: number };
};

export type ShopFeedFilters = {
  q?: string;
  city?: string | null;
  category?: string | null;
  trade?: string | null;
  limit?: number;
  offset?: number;
  excludeUserId?: string | null;
};

const SITE = env.publicSiteUrl || "https://karoonline.in";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s || null;
}

function idOf(v: unknown): string {
  return String(v ?? "");
}

function mediaType(raw: unknown): "image" | "video" | "url" {
  if (raw === "video" || raw === "url" || raw === "image") return raw;
  return "video";
}

function parseMedia(raw: unknown): FeedMedia | null {
  const o = asRecord(raw);
  const src = str(o?.src);
  if (!src) return null;
  return {
    type: mediaType(o?.type),
    src,
    poster: str(o?.poster),
    products: parseProducts(o?.products),
  };
}

function parseProducts(raw: unknown): FeedProduct[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedProduct[] = [];
  for (const item of raw) {
    const o = asRecord(item);
    if (!o) continue;
    const name = str(o.name) ?? "Item";
    const cta = asRecord(o.cta);
    out.push({
      id: idOf(o.id) || `p-${out.length}`,
      name,
      price: o.price == null ? null : String(o.price),
      mrp: o.mrp == null ? null : String(o.mrp),
      image: str(o.image),
      cta: cta
        ? {
            preset: str(cta.preset),
            label: str(cta.label),
            color: str(cta.color),
            url: str(cta.url),
          }
        : null,
    });
  }
  return out;
}

function firstKeyedProducts(map: unknown): FeedProduct[] {
  const o = asRecord(map);
  if (!o) return [];
  for (const v of Object.values(o)) {
    const list = parseProducts(v);
    if (list.length) return list;
  }
  return [];
}

function latestFromPoster(poster: unknown): { item: FeedMedia | null; index: number; count: number } {
  const arr = Array.isArray(poster) ? poster.map(parseMedia).filter((m): m is FeedMedia => !!m) : [];
  if (!arr.length) return { item: null, index: 0, count: 0 };
  return { item: arr[arr.length - 1] ?? null, index: arr.length - 1, count: arr.length };
}

function shopUrl(code: string | null, slug: string): string | null {
  if (!code) return null;
  return `${SITE}/s/${encodeURIComponent(code)}?p=${encodeURIComponent(slug)}`;
}

function hay(p: Record<string, unknown>): string {
  return [p.business_name, p.title, p.name, p.category, p.city, p.trade_type]
    .map((x) => (typeof x === "string" ? x : ""))
    .join(" ")
    .toLowerCase();
}

/**
 * Public discovery feed: every other live shop as its latest studio video
 * plus products tagged to that video. Mirrors karo-online-main list_public_shop_feed.
 */
export async function listPublicShopFeed(filters: ShopFeedFilters): Promise<VendorFeedRow[]> {
  const sb = tryServiceRole();
  if (!sb) return [];

  const limit = Math.max(1, Math.min(Number(filters.limit ?? 12) || 12, 50));
  const offset = Math.max(0, Number(filters.offset ?? 0) || 0);
  const q = (filters.q ?? "").trim().toLowerCase();
  const city = (filters.city ?? "").trim().toLowerCase();
  const category = (filters.category ?? "").trim().toLowerCase();
  const trade = (filters.trade ?? "").trim().toLowerCase();
  const exclude = filters.excludeUserId ? String(filters.excludeUserId) : "";

  const fetched = await sb.from("qr_projects").select("*").order("created_at", { ascending: false }).limit(240);
  if (fetched.error) console.warn("[shop-feed] qr_projects", fetched.error.message);

  const projects = (Array.isArray(fetched.data) ? (fetched.data as Record<string, unknown>[]) : []).filter((p) => {
    if (exclude && idOf(p.user_id) === exclude) return false;
    const h = hay(p);
    if (q && !h.includes(q)) return false;
    if (city && !String(p.city ?? "").toLowerCase().includes(city)) return false;
    if (category && !String(p.category ?? "").toLowerCase().includes(category)) return false;
    if (trade && String(p.trade_type ?? "").toLowerCase() !== trade) return false;
    return true;
  });

  const ids = projects.map((p) => idOf(p.id)).filter(Boolean);
  const userIds = [...new Set(projects.map((p) => idOf(p.user_id)).filter(Boolean))];

  const settingsByProject = new Map<string, Record<string, unknown>>();
  const settingsByUser = new Map<string, Record<string, unknown>>();
  if (ids.length) {
    const byProject = await sb
      .from("merchant_link_settings")
      .select("*")
      .in("project_id", ids);
    if (!byProject.error && Array.isArray(byProject.data)) {
      for (const row of byProject.data as Record<string, unknown>[]) {
        settingsByProject.set(idOf(row.project_id), row);
      }
    } else if (userIds.length) {
      const byUser = await sb.from("merchant_link_settings").select("*").in("user_id", userIds);
      if (!byUser.error && Array.isArray(byUser.data)) {
        for (const row of byUser.data as Record<string, unknown>[]) {
          const pid = idOf(row.project_id);
          if (pid) settingsByProject.set(pid, row);
          else settingsByUser.set(idOf(row.user_id), row);
        }
      }
    }
  }

  const codesByUser = new Map<string, string>();
  if (userIds.length) {
    const codes = await sb.from("referral_codes").select("user_id, code").in("user_id", userIds);
    if (!codes.error && Array.isArray(codes.data)) {
      for (const row of codes.data as Record<string, unknown>[]) {
        const code = str(row.code);
        if (code) codesByUser.set(idOf(row.user_id), code);
      }
    }
  }

  const productsByProject = new Map<string, FeedProduct[]>();
  if (ids.length) {
    const items = await sb
      .from("shop_products")
      .select("id, project_id, name, price, category")
      .in("project_id", ids)
      .eq("is_active", true)
      .limit(400);
    if (!items.error && Array.isArray(items.data)) {
      for (const row of items.data as Record<string, unknown>[]) {
        const pid = idOf(row.project_id);
        const list = productsByProject.get(pid) ?? [];
        if (list.length >= 4) continue;
        list.push({
          id: idOf(row.id) || `p-${list.length}`,
          name: str(row.name) ?? "Item",
          price: row.price == null ? null : `₹${Number(row.price).toFixed(0)}`,
          image: str(row.image_url) ?? str(row.image),
        });
        productsByProject.set(pid, list);
      }
    }
  }

  const rows: VendorFeedRow[] = projects.map((p) => {
    const pid = idOf(p.id);
    const uid = idOf(p.user_id);
    const settings = settingsByProject.get(pid) ?? settingsByUser.get(uid) ?? null;
    const latest = latestFromPoster(settings?.poster_media);
    let media = latest.item;
    if (!media) {
      const cover = str(p.cover_image_url);
      if (cover) media = { type: "image", src: cover, poster: cover, products: [] };
    }
    let tagged = media?.products?.length ? media.products : [];
    if (!tagged.length) tagged = firstKeyedProducts(settings?.yt_products);
    if (!tagged.length) tagged = firstKeyedProducts(settings?.ig_products);
    if (!tagged.length) tagged = firstKeyedProducts(settings?.pin_products);
    const products = tagged.length ? tagged : productsByProject.get(pid) ?? [];
    const code = str(p.share_code) ?? codesByUser.get(uid) ?? str(p.slug);
    const slug = str(p.slug) ?? pid;
    const name = str(p.business_name) ?? str(p.title) ?? str(p.name) ?? "Shop";
    return {
      slug,
      name,
      category: str(p.category),
      city: str(p.city),
      trade_type: str(p.trade_type),
      avatar_url: str(p.avatar_url),
      cover_image_url: str(p.cover_image_url),
      contact_phone: str(p.contact_phone),
      code,
      shop_url: shopUrl(code, slug),
      sponsored: p.is_paid === true,
      created_at: typeof p.created_at === "string" ? p.created_at : new Date().toISOString(),
      latest_media: media,
      latest_index: latest.index,
      media_count: latest.count,
      products: products.slice(0, 8),
      has_video: !!(latest.item && media?.type !== "image") || media?.type === "video",
      stats: { views: 0, likes: 0, comments: 0, shares: 0 },
    };
  });

  const vendorFetch = await sb.from("vendors").select("*").limit(80);
  if (vendorFetch.error) console.warn("[shop-feed] vendors", vendorFetch.error.message);
  const seen = new Set(rows.map((r) => r.slug.toLowerCase()));
  for (const v of Array.isArray(vendorFetch.data) ? (vendorFetch.data as Record<string, unknown>[]) : []) {
    if (v.is_blocked === true) continue;
    const status = String(v.status ?? "active").toLowerCase();
    if (status === "blocked" || status === "rejected" || status === "inactive") continue;
    const name = str(v.business_name) ?? str(v.owner_name) ?? "Vendor";
    const video = str(v.cover_video_url);
    const image = str(v.cover_image_url) ?? str(v.profile_photo_url) ?? str(v.avatar_url);
    const h = [name, v.trade, v.deals_in, v.city].map((x) => (typeof x === "string" ? x : "")).join(" ").toLowerCase();
    if (q && !h.includes(q)) continue;
    if (city && !String(v.city ?? "").toLowerCase().includes(city)) continue;
    if (category && !String(v.trade ?? v.deals_in ?? "").toLowerCase().includes(category)) continue;
    const slug = idOf(v.id) || name.toLowerCase().replace(/\s+/g, "-");
    if (seen.has(slug.toLowerCase()) || seen.has(name.toLowerCase())) continue;
    seen.add(slug.toLowerCase());
    seen.add(name.toLowerCase());
    const media: FeedMedia | null = video
      ? { type: "video", src: video, poster: image, products: [] }
      : image
        ? { type: "image", src: image, poster: image, products: [] }
        : null;
    rows.push({
      slug,
      name,
      category: str(v.trade) ?? str(v.deals_in),
      city: str(v.city),
      trade_type: str(v.trade),
      avatar_url: str(v.profile_photo_url) ?? str(v.avatar_url),
      cover_image_url: image,
      contact_phone: str(v.phone) ?? str(v.contact_phone),
      code: slug,
      shop_url: null,
      sponsored: v.verified === true,
      created_at: typeof v.created_at === "string" ? v.created_at : new Date().toISOString(),
      latest_media: media,
      latest_index: 0,
      media_count: media ? 1 : 0,
      products: [],
      has_video: !!video,
      stats: { views: 0, likes: 0, comments: 0, shares: 0 },
    });
  }

  rows.sort((a, b) => {
    if (a.has_video !== b.has_video) return a.has_video ? -1 : 1;
    if (a.sponsored !== b.sponsored) return a.sponsored ? -1 : 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return rows.slice(offset, offset + limit);
}
