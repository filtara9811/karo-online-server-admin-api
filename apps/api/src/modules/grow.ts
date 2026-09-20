import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { readBearer, requireAuth } from "../middleware/auth.js";
import { createUserClient, getServiceRoleClient, tryServiceRole } from "../lib/supabase.js";
import { hasDatabase } from "../config/env.js";
import { pickService, createCashfreeOrder } from "../lib/cashfree.js";
import { env } from "../config/env.js";
import { listPublicShopFeed } from "../lib/shop-feed.js";

export const growRouter = Router();

const PROJECT_PRICE_INR = 599;
const SITE = env.publicSiteUrl || "https://karoonline.in";

type GrowProject = {
  id: string;
  user_id: string;
  title: string;
  name?: string | null;
  slug: string;
  business_name?: string | null;
  contact_phone?: string | null;
  category?: string | null;
  city?: string | null;
  trade_type?: string | null;
  theme_key?: string | null;
  accent_color?: string | null;
  description?: string | null;
  is_paid: boolean;
  price_inr: number;
  ads_enabled?: boolean;
  ad_budget_inr?: number;
  share_code?: string | null;
  shop_url?: string;
  qr_url?: string;
  created_at: string;
};

type ShopProduct = {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  price: number;
  category?: string | null;
  stock: number;
  is_active: boolean;
  created_at: string;
};

type ShopOrder = {
  id: string;
  project_id: string | null;
  user_id?: string | null;
  code: string;
  visitor_name?: string | null;
  visitor_phone?: string | null;
  items: unknown[];
  total_inr: number;
  status: string;
  created_at: string;
};

type Campaign = {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  budget_inr: number;
  clicks: number;
  status: string;
  created_at: string;
};

const memProjects: GrowProject[] = [];
const memProducts: ShopProduct[] = [];
const memOrders: ShopOrder[] = [];
const memCampaigns: Campaign[] = [];
const memJoins: { id: string; program_id: string; user_id: string }[] = [];
const memLinks = new Map<string, Record<string, unknown>>();

function defaultLinkSettings(): Record<string, unknown> {
  return {
    play_store_enabled: true,
    payment_enabled: false,
    payment_provider: "upi",
    payment_upi_id: "",
    payment_label: "",
    payment_amount_inr: "",
    digital_shop_enabled: false,
    digital_shop_url: "",
    extra_links: [],
    premium_unlocked: false,
    poster_media: [],
    poster_bg_urls: [],
    poster_bg_url: null,
    yt_source: "",
    yt_enabled: false,
    yt_products: {},
    ig_source: "",
    ig_enabled: false,
    ig_products: {},
    pin_source: "",
    pin_enabled: false,
    pin_products: {},
  };
}

function jsonValue(v: unknown, fallback: unknown) {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  }
  return v ?? fallback;
}

type YtThumb = { id: string; title: string; thumbnail: string | null };

const YT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-IN,en;q=0.9",
};

const INVIDIOUS = ["https://inv.nadeko.net", "https://yewtu.be", "https://invidious.nerdvpn.de"];
const feedCache = new Map<string, { at: number; videos: YtThumb[] }>();
const handleCache = new Map<string, string>();
const FEED_TTL_MS = 30 * 60 * 1000;

function feedKey(source: string) {
  return source.trim().toLowerCase().replace(/^@+/, "@");
}

async function fetchText(url: string, ms = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: YT_HEADERS, redirect: "follow", signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextQuiet(url: string, ms = 7000) {
  try {
    return await fetchText(url, ms);
  } catch {
    return "";
  }
}

function channelIdFromHtml(html: string) {
  return (
    /"browseId":"(UC[\w-]{20,})"/i.exec(html)?.[1] ??
    /"externalId":"(UC[\w-]{20,})"/i.exec(html)?.[1] ??
    /"channelId":"(UC[\w-]{20,})"/i.exec(html)?.[1] ??
    /youtube\.com\/channel\/(UC[\w-]{20,})/i.exec(html)?.[1] ??
    null
  );
}

function parseRss(xml: string): YtThumb[] {
  const out: YtThumb[] = [];
  const re = /<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<media:title>([^<]*)<\/media:title>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < 25) {
    out.push({ id: m[1], title: m[2] || "YouTube video", thumbnail: `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` });
  }
  if (!out.length) {
    for (const id of [...xml.matchAll(/<yt:videoId>([^<]+)<\/yt:videoId>/g)].map((x) => x[1]).slice(0, 25)) {
      out.push({ id, title: "YouTube video", thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg` });
    }
  }
  return out;
}

async function videosFromRss(feed: string) {
  const xml = await fetchTextQuiet(feed);
  return xml ? parseRss(xml) : [];
}

function videosFromHtml(html: string): YtThumb[] {
  const seen = new Set<string>();
  const out: YtThumb[] = [];
  for (const m of html.matchAll(/"videoId":"([\w-]{11})"/g)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = new RegExp(`"videoId":"${id}"[\\s\\S]{0,400}?"title":\\{"runs":\\[\\{"text":"([^"]+)"`).exec(html)?.[1];
    out.push({ id, title: title || "YouTube video", thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg` });
    if (out.length >= 25) break;
  }
  return out;
}

async function videosFromInvidious(idOrHandle: string): Promise<YtThumb[]> {
  const id = encodeURIComponent(idOrHandle.replace(/^@+/, ""));
  for (const base of INVIDIOUS) {
    for (const path of [`/api/v1/channels/${id}/latest`, `/api/v1/channels/${id}/videos`]) {
      try {
        const r = await fetch(`${base}${path}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(7000),
        });
        if (!r.ok) continue;
        const data = (await r.json()) as { videos?: Array<{ videoId?: string; title?: string }> } | Array<{ videoId?: string; title?: string }>;
        const rows = Array.isArray(data) ? data : data.videos ?? [];
        const videos = rows
          .map((v) => (v.videoId ? { id: v.videoId, title: v.title || "YouTube video", thumbnail: `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg` } : null))
          .filter((v): v is YtThumb => !!v)
          .slice(0, 25);
        if (videos.length) return videos;
      } catch {
        /* next host */
      }
    }
  }
  return [];
}

async function videosFromApi(channelId: string): Promise<YtThumb[]> {
  const key = env.youtubeApiKey;
  if (!key) return [];
  const uploads = channelId.startsWith("UC") ? `UU${channelId.slice(2)}` : channelId;
  const qs = new URLSearchParams({
    part: "snippet,contentDetails",
    playlistId: uploads,
    maxResults: "25",
    key,
  });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${qs}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [];
  const j = (await r.json()) as { items?: Array<{ contentDetails?: { videoId?: string }; snippet?: { title?: string; resourceId?: { videoId?: string } } }> };
  return (j.items ?? [])
    .map((it) => {
      const id = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
      if (!id) return null;
      return { id, title: it.snippet?.title || "YouTube video", thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg` };
    })
    .filter((v): v is YtThumb => !!v);
}

async function resolveHandle(handle: string): Promise<string | null> {
  const h = handle.replace(/^@+/, "").trim();
  if (!h) return null;
  const cached = handleCache.get(h.toLowerCase());
  if (cached) return cached;
  if (env.youtubeApiKey) {
    try {
      const qs = new URLSearchParams({ part: "id", forHandle: `@${h}`, key: env.youtubeApiKey });
      const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?${qs}`, { signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as { items?: Array<{ id?: string }> };
      if (j.items?.[0]?.id?.startsWith("UC")) {
        handleCache.set(h.toLowerCase(), j.items[0].id!);
        return j.items[0].id!;
      }
    } catch {
      /* scrape next */
    }
  }
  for (const url of [`https://www.youtube.com/@${h}`, `https://www.youtube.com/@${h}/videos`, `https://www.youtube.com/@${h}/about`]) {
    const id = channelIdFromHtml(await fetchTextQuiet(url));
    if (id) {
      handleCache.set(h.toLowerCase(), id);
      return id;
    }
  }
  for (const base of INVIDIOUS) {
    try {
      const r = await fetch(`${base}/api/v1/channels/${encodeURIComponent(h)}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) continue;
      const data = (await r.json()) as { authorId?: string };
      if (data.authorId?.startsWith("UC")) {
        handleCache.set(h.toLowerCase(), data.authorId);
        return data.authorId;
      }
    } catch {
      /* next */
    }
  }
  return null;
}

async function youtubeFeedFromSource(source: string): Promise<YtThumb[]> {
  const s = source.trim();
  if (!s) return [];
  const cached = feedCache.get(feedKey(s));
  if (cached && Date.now() - cached.at < FEED_TTL_MS) return cached.videos;

  const watch = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i.exec(s)?.[1];
  if (watch && !/list=|@|UC[\w-]{20,}|channel\//i.test(s)) {
    return [{ id: watch, title: "YouTube video", thumbnail: `https://img.youtube.com/vi/${watch}/hqdefault.jpg` }];
  }
  const playlist = /(?:[?&]list=|playlist_id=)([\w-]+)/i.exec(s)?.[1] ?? (/^PL[\w-]+$/i.test(s) ? s : null);
  const channel = /(?:channel\/|channel_id=)(UC[\w-]+)/i.exec(s)?.[1] ?? (/^UC[\w-]{20,}$/.test(s) ? s : null);
  const handle =
    /youtube\.com\/@([^/?#]+)/i.exec(s)?.[1] ??
    (s.startsWith("@") ? s.slice(1) : /^[\w.]{3,32}$/.test(s) && !s.startsWith("UC") ? s : null);
  if (playlist) {
    const videos = await videosFromRss(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlist)}`);
    return videos.length ? videos : videosFromInvidious(playlist);
  }
  let channelId = channel;
  if (!channelId && handle) channelId = await resolveHandle(handle);
  const lookups = [
    channelId ? () => videosFromApi(channelId!) : null,
    channelId ? () => videosFromRss(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId!)}`) : null,
    handle ? () => videosFromRss(`https://www.youtube.com/feeds/videos.xml?user=${encodeURIComponent(handle)}`) : null,
    channelId ? () => videosFromInvidious(channelId!) : null,
    handle ? () => videosFromInvidious(handle) : null,
    handle ? async () => videosFromHtml(await fetchTextQuiet(`https://www.youtube.com/@${handle}/videos`)) : null,
  ].filter((fn): fn is () => Promise<YtThumb[]> => !!fn);

  for (const fn of lookups) {
    const videos = await fn();
    if (videos.length) {
      feedCache.set(feedKey(s), { at: Date.now(), videos });
      return videos;
    }
  }
  return cached?.videos ?? [];
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || `qr-${Date.now().toString(36)}`
  );
}

function decorate(p: GrowProject): GrowProject {
  const code = p.share_code || p.slug;
  return {
    ...p,
    shop_url: `${SITE}/s/${encodeURIComponent(code)}?p=${encodeURIComponent(p.slug)}`,
    qr_url: `${SITE}/q/${encodeURIComponent(p.slug)}`,
    price_inr: Number(p.price_inr ?? PROJECT_PRICE_INR),
    is_paid: !!p.is_paid,
  };
}

async function shareCode(sb: NonNullable<ReturnType<typeof tryServiceRole>>, userId: string, fallback: string) {
  const rc = await sb.from("referral_codes").select("code").eq("user_id", userId).maybeSingle();
  if (rc.data?.code) return String(rc.data.code);
  const generated = `GROW-${fallback.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || randomUUID().slice(0, 6)}`;
  await sb.from("referral_codes").insert({ user_id: userId, code: generated }).then(() => undefined).catch(() => undefined);
  return generated;
}

function client() {
  if (hasDatabase()) return getServiceRoleClient();
  return tryServiceRole();
}

growRouter.get(
  "/projects",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("qr_projects").select("*").eq("user_id", req.userId!).order("created_at", { ascending: false });
      if (!error) return ok(res, { projects: (data ?? []).map((p) => decorate(p as GrowProject)) });
    }
    return ok(res, { projects: memProjects.filter((p) => p.user_id === req.userId).map(decorate), seeded: true });
  }),
);

growRouter.post(
  "/projects",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        title: z.string().min(2).max(120),
        business_name: z.string().max(120).optional(),
        contact_phone: z.string().max(20).optional(),
        city: z.string().max(80).optional(),
        category: z.string().max(80).optional(),
        theme_key: z.string().max(40).optional(),
        accent_color: z.string().max(20).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const slug = slugify(`${parsed.data.business_name || parsed.data.title}-${Date.now().toString(36)}`);
    const sb = client();
    if (sb) {
      const code = await shareCode(sb, req.userId!, slug);
      const row = {
        user_id: req.userId,
        title: parsed.data.title,
        name: parsed.data.title,
        slug,
        business_name: parsed.data.business_name ?? parsed.data.title,
        contact_phone: parsed.data.contact_phone ?? null,
        city: parsed.data.city ?? null,
        category: parsed.data.category ?? null,
        theme_key: parsed.data.theme_key ?? "classic-amber",
        accent_color: parsed.data.accent_color ?? "#d4af37",
        is_paid: false,
        price_inr: PROJECT_PRICE_INR,
        share_code: code,
      };
      const { data, error } = await sb.from("qr_projects").insert(row).select("*").maybeSingle();
      if (error || !data) {
        console.error("[projects] insert failed:", error?.message ?? "no row");
        return fail(res, 500, "Project save nahi ho paya.");
      }
        await sb
          .from("digital_shops")
          .upsert({ user_id: req.userId, name: parsed.data.title, slug, project_id: data.id }, { onConflict: "user_id" })
          .then(() => undefined)
          .catch(() => undefined);
        return ok(res, { project: decorate(data as GrowProject) }, 201);
    }
    const project: GrowProject = {
      id: randomUUID(),
      user_id: req.userId!,
      title: parsed.data.title,
      slug,
      business_name: parsed.data.business_name ?? parsed.data.title,
      city: parsed.data.city ?? null,
      category: parsed.data.category ?? null,
      is_paid: false,
      price_inr: PROJECT_PRICE_INR,
      share_code: slug,
      created_at: new Date().toISOString(),
    };
    memProjects.unshift(project);
    return ok(res, { project: decorate(project), seeded: true }, 201);
  }),
);

growRouter.get(
  "/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("qr_projects").select("*").eq("id", id).eq("user_id", req.userId!).maybeSingle();
      if (!error && data) return ok(res, { project: decorate(data as GrowProject) });
    }
    const project = memProjects.find((p) => p.id === id && p.user_id === req.userId);
    if (!project) return fail(res, 404, "project not found");
    return ok(res, { project: decorate(project), seeded: true });
  }),
);

growRouter.patch(
  "/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = z
      .object({
        title: z.string().min(2).max(120).optional(),
        business_name: z.string().max(120).optional(),
        description: z.string().max(2000).optional(),
        contact_phone: z.string().max(20).optional(),
        theme_key: z.string().max(40).optional(),
        accent_color: z.string().max(20).optional(),
        city: z.string().max(80).optional(),
        category: z.string().max(80).optional(),
        ads_enabled: z.boolean().optional(),
        ad_budget_inr: z.number().min(0).optional(),
        trade_type: z.string().max(80).optional(),
        avatar_url: z.string().max(2000).optional(),
        cover_image_url: z.string().max(2000).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = client();
    if (sb) {
      const { data, error } = await sb
        .from("qr_projects")
        .update(parsed.data)
        .eq("id", id)
        .eq("user_id", req.userId!)
        .select("*")
        .maybeSingle();
      if (!error && data) return ok(res, { project: decorate(data as GrowProject) });
    }
    const project = memProjects.find((p) => p.id === id && p.user_id === req.userId);
    if (!project) return fail(res, 404, "project not found");
    Object.assign(project, parsed.data);
    return ok(res, { project: decorate(project), seeded: true });
  }),
);

growRouter.get(
  "/projects/:id/visits",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data: project } = await sb.from("qr_projects").select("id, slug, share_code").eq("id", id).eq("user_id", req.userId!).maybeSingle();
      if (project) {
        const { data, error } = await sb
          .from("shop_visits")
          .select("*")
          .or(`project_id.eq.${id},project_slug.eq.${project.slug},code.eq.${project.share_code ?? project.slug}`)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) console.error("[visits] list failed:", error.message);
        return ok(res, { visits: data ?? [] });
      }
    }
    return ok(res, { visits: [], seeded: true });
  }),
);

growRouter.get(
  "/projects/:id/products",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("shop_products").select("*").eq("project_id", id).order("created_at", { ascending: false });
      if (!error) return ok(res, { products: data ?? [] });
    }
    return ok(res, { products: memProducts.filter((p) => p.project_id === id), seeded: true });
  }),
);

growRouter.post(
  "/projects/:id/products",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = z
      .object({
        name: z.string().min(1).max(160),
        price: z.number().min(0).max(1_000_000).optional(),
        category: z.string().max(80).optional(),
        stock: z.number().min(0).max(1_000_000).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const row = {
      project_id: id,
      user_id: req.userId,
      name: parsed.data.name,
      price: parsed.data.price ?? 0,
      category: parsed.data.category ?? null,
      stock: parsed.data.stock ?? 0,
      is_active: true,
    };
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("shop_products").insert(row).select("*").maybeSingle();
      if (!error && data) return ok(res, { product: data }, 201);
    }
    const product: ShopProduct = { id: randomUUID(), ...row, user_id: req.userId!, created_at: new Date().toISOString(), is_active: true, stock: row.stock ?? 0, price: row.price ?? 0 };
    memProducts.unshift(product);
    return ok(res, { product, seeded: true }, 201);
  }),
);

growRouter.patch(
  "/products/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = z
      .object({
        name: z.string().min(1).max(160).optional(),
        price: z.number().min(0).optional(),
        stock: z.number().min(0).optional(),
        category: z.string().max(80).optional(),
        is_active: z.boolean().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("shop_products").update(parsed.data).eq("id", id).eq("user_id", req.userId!).select("*").maybeSingle();
      if (!error && data) return ok(res, { product: data });
    }
    const product = memProducts.find((p) => p.id === id && p.user_id === req.userId);
    if (!product) return fail(res, 404, "product not found");
    Object.assign(product, parsed.data);
    return ok(res, { product, seeded: true });
  }),
);

growRouter.get(
  "/projects/:id/orders",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("shop_orders").select("*").eq("project_id", id).order("created_at", { ascending: false });
      if (!error) return ok(res, { orders: data ?? [] });
    }
    return ok(res, { orders: memOrders.filter((o) => o.project_id === id), seeded: true });
  }),
);

growRouter.get(
  "/projects/:id/campaigns",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("qr_campaigns").select("*").eq("project_id", id).order("created_at", { ascending: false });
      if (!error) return ok(res, { campaigns: data ?? [] });
    }
    return ok(res, { campaigns: memCampaigns.filter((c) => c.project_id === id), seeded: true });
  }),
);

growRouter.post(
  "/projects/:id/campaigns",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = z.object({ title: z.string().min(2).max(120), budget_inr: z.number().min(0).optional() }).safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const row = {
      project_id: id,
      user_id: req.userId,
      title: parsed.data.title,
      budget_inr: parsed.data.budget_inr ?? 0,
      clicks: 0,
      status: "draft",
    };
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("qr_campaigns").insert(row).select("*").maybeSingle();
      if (!error && data) return ok(res, { campaign: data }, 201);
    }
    const campaign: Campaign = { id: randomUUID(), ...row, user_id: req.userId!, created_at: new Date().toISOString() };
    memCampaigns.unshift(campaign);
    return ok(res, { campaign, seeded: true }, 201);
  }),
);

growRouter.get(
  "/themes",
  asyncHandler(async (_req, res) => {
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("qr_landing_themes").select("*").eq("is_active", true);
      if (!error && data && data.length) return ok(res, { themes: data });
    }
    return ok(res, {
      themes: [
        { key: "classic", name: "Classic gold", accent_color: "#d4af37", bg_from: "#1a1208", bg_to: "#0a0804", is_premium: false },
        { key: "night", name: "Night", accent_color: "#f5d97a", bg_from: "#12100a", bg_to: "#000000", is_premium: true },
      ],
    });
  }),
);

growRouter.get(
  "/shop-feed",
  asyncHandler(async (req, res) => {
    let excludeUserId: string | undefined;
    const token = readBearer(req);
    if (token) {
      try {
        const { data } = await createUserClient(token).auth.getUser(token);
        if (data.user?.id) excludeUserId = data.user.id;
      } catch {
        /* public feed */
      }
    }
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const city = typeof req.query.city === "string" ? req.query.city : "";
    const category = typeof req.query.category === "string" ? req.query.category : "";
    const trade = typeof req.query.trade === "string" ? req.query.trade : "";
    const limit = Number(req.query.limit ?? 12);
    const offset = Number(req.query.offset ?? 0);
    const rows = await listPublicShopFeed({
      q,
      city: city || null,
      category: category || null,
      trade: trade || null,
      limit,
      offset,
      excludeUserId,
    });
    return ok(res, { rows });
  }),
);

growRouter.get(
  "/programs",
  asyncHandler(async (_req, res) => {
    const sb = client();
    if (sb) {
      const { data, error } = await sb.from("vendor_programs").select("*").eq("is_active", true).order("created_at", { ascending: false });
      if (!error && data && data.length) return ok(res, { programs: data });
    }
    return ok(res, {
      programs: [
        {
          id: "all-program",
          title: "ALL Program — City partners",
          city: "Pan India",
          trade: "Multi-trade",
          description: "Featured vendors who accept Assan Grow QR walk-ins and share leads.",
          is_active: true,
        },
        {
          id: "gold-shopfront",
          title: "Gold shopfront",
          city: "Delhi NCR",
          trade: "Retail",
          description: "Premium placement on the digital shop catalog.",
          is_active: true,
        },
      ],
    });
  }),
);

growRouter.post(
  "/programs/:id/join",
  requireAuth,
  asyncHandler(async (req, res) => {
    const programId = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data, error } = await sb
        .from("vendor_program_joins")
        .insert({ program_id: programId, user_id: req.userId })
        .select("*")
        .maybeSingle();
      if (!error) return ok(res, { join: data }, 201);
    }
    const join = { id: randomUUID(), program_id: programId, user_id: req.userId! };
    memJoins.unshift(join);
    return ok(res, { join, seeded: true }, 201);
  }),
);

growRouter.post(
  "/projects/:id/pay",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    let svc: Awaited<ReturnType<typeof pickService>> = null;
    try {
      svc = await pickService("vendor_wallet_recharge");
    } catch {
      svc = null;
    }
    if (!svc?.app_id || !svc.secret_key) {
      return ok(res, {
        paid: false,
        needs_keys: true,
        price_inr: PROJECT_PRICE_INR,
        message: "Add Cashfree App ID & Secret in admin to charge ₹599. Project stays draft until keys exist.",
      });
    }
    const created = await createCashfreeOrder(
      req.userId!,
      { amount_inr: PROJECT_PRICE_INR, purpose: "vendor_wallet_recharge" },
      env.corsOrigin === "*" ? SITE : env.corsOrigin.split(",")[0] ?? SITE,
    );
    if (!created.ok) {
      return ok(res, { paid: false, needs_keys: true, price_inr: PROJECT_PRICE_INR, message: created.error });
    }
    return ok(res, { paid: false, needs_keys: false, price_inr: PROJECT_PRICE_INR, ...created, project_id: id });
  }),
);

growRouter.post(
  "/projects/:id/pay/verify",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const orderId = typeof req.body?.order_id === "string" ? req.body.order_id : "";
    if (!orderId) return fail(res, 400, "order_id required");
    const sb = client();
    if (sb) {
      const { data } = await sb
        .from("qr_projects")
        .update({ is_paid: true })
        .eq("id", id)
        .eq("user_id", req.userId!)
        .select("*")
        .maybeSingle();
      if (data) return ok(res, { project: decorate(data as GrowProject), paid: true });
    }
    const project = memProjects.find((p) => p.id === id && p.user_id === req.userId);
    if (project) project.is_paid = true;
    return ok(res, { paid: true, project: project ? decorate(project) : null, order_id: orderId });
  }),
);

growRouter.delete(
  "/projects/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { error } = await sb.from("qr_projects").delete().eq("id", id).eq("user_id", req.userId!);
      if (!error) return ok(res, { deleted: true });
    }
    const idx = memProjects.findIndex((p) => p.id === id && p.user_id === req.userId);
    if (idx >= 0) memProjects.splice(idx, 1);
    return ok(res, { deleted: true, seeded: true });
  }),
);

growRouter.post(
  "/projects/:id/visits",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = z
      .object({
        visitor_name: z.string().min(1).max(120),
        visitor_phone: z.string().max(20).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = client();
    if (sb) {
      const { data: project } = await sb
        .from("qr_projects")
        .select("id, slug, share_code")
        .eq("id", id)
        .eq("user_id", req.userId!)
        .maybeSingle();
      if (project) {
        const row = {
          project_id: id,
          project_slug: project.slug,
          code: project.share_code || project.slug,
          kind: "manual",
          source: "grow-app",
          visitor_name: parsed.data.visitor_name,
          visitor_phone: parsed.data.visitor_phone ?? null,
        };
        const { data, error } = await sb.from("shop_visits").insert(row).select("*").maybeSingle();
        if (error || !data) {
          console.error("[visits] insert failed:", error?.message ?? "no row");
          return fail(res, 500, "Visitor save nahi ho paya.");
        }
        return ok(res, { visit: data }, 201);
      }
    }
    return ok(res, {
      visit: {
        id: randomUUID(),
        project_id: id,
        visitor_name: parsed.data.visitor_name,
        visitor_phone: parsed.data.visitor_phone ?? null,
        created_at: new Date().toISOString(),
      },
      seeded: true,
    }, 201);
  }),
);

growRouter.get(
  "/projects/:id/analytics",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 7));
    const sb = client();
    let visits: Array<{ created_at?: string; visitor_phone?: string | null }> = [];
    if (sb) {
      const { data: project } = await sb.from("qr_projects").select("id, slug, share_code").eq("id", id).eq("user_id", req.userId!).maybeSingle();
      if (project) {
        const { data } = await sb
          .from("shop_visits")
          .select("created_at, visitor_phone")
          .or(`project_id.eq.${id},project_slug.eq.${project.slug}`)
          .order("created_at", { ascending: false })
          .limit(500);
        visits = (data ?? []) as typeof visits;
      }
    }
    const out: { day: string; visitors: number; unique: number; customers: number }[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const start = new Date(base);
      start.setDate(start.getDate() - i);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const inDay = visits.filter((v) => {
        const t = new Date(v.created_at ?? 0).getTime();
        return t >= start.getTime() && t < end.getTime();
      });
      out.push({
        day: start.toISOString().slice(0, 10),
        visitors: inDay.length,
        unique: inDay.length,
        customers: inDay.filter((r) => r.visitor_phone).length,
      });
    }
    return ok(res, {
      days: out,
      totals: {
        visits: visits.length,
        unique: visits.length,
        customers: visits.filter((v) => v.visitor_phone).length,
      },
    });
  }),
);

growRouter.get(
  "/tutorial/:section",
  requireAuth,
  asyncHandler(async (req, res) => {
    const section = String(req.params.section || "").trim();
    const sb = client();
    if (sb && section) {
      const { data } = await sb
        .from("oneqr_tutorial_videos")
        .select("id, section, title, caption, youtube_url, video_url, is_active")
        .eq("section", section)
        .eq("is_active", true)
        .maybeSingle();
      return ok(res, { video: data ?? null });
    }
    return ok(res, { video: null });
  }),
);

growRouter.get(
  "/projects/:id/links",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const sb = client();
    if (sb) {
      const { data: project } = await sb
        .from("qr_projects")
        .select("id, is_paid")
        .eq("id", id)
        .eq("user_id", req.userId!)
        .maybeSingle();
      if (!project) return fail(res, 404, "project not found");
      let { data: row } = await sb
        .from("merchant_link_settings")
        .select("*")
        .eq("user_id", req.userId!)
        .eq("project_id", id)
        .maybeSingle();
      if (!row) {
        const fallback = await sb
          .from("merchant_link_settings")
          .select("*")
          .eq("user_id", req.userId!)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        row = fallback.data;
      }
      const r = (row ?? {}) as Record<string, unknown>;
      return ok(res, {
        settings: {
          ...defaultLinkSettings(),
          ...r,
          extra_links: jsonValue(r.extra_links, []),
          poster_media: jsonValue(r.poster_media, []),
          poster_bg_urls: jsonValue(r.poster_bg_urls, []),
          yt_products: jsonValue(r.yt_products, {}),
          ig_products: jsonValue(r.ig_products, {}),
          pin_products: jsonValue(r.pin_products, {}),
          premium_unlocked: !!r.premium_unlocked || !!(project as { is_paid?: boolean }).is_paid,
        },
      });
    }
    return ok(res, { settings: memLinks.get(`${req.userId}:${id}`) ?? defaultLinkSettings(), seeded: true });
  }),
);

growRouter.put(
  "/projects/:id/links",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = z
      .object({
        play_store_enabled: z.boolean().optional(),
        payment_enabled: z.boolean().optional(),
        payment_provider: z.string().max(40).optional(),
        payment_upi_id: z.string().max(200).optional(),
        payment_label: z.string().max(80).optional(),
        payment_amount_inr: z.union([z.string(), z.number()]).optional(),
        digital_shop_enabled: z.boolean().optional(),
        digital_shop_url: z.string().max(2000).optional(),
        extra_links: z
          .array(
            z.object({
              id: z.string(),
              label: z.string(),
              url: z.string(),
              enabled: z.boolean().optional(),
              category: z.string().optional(),
              price: z.union([z.string(), z.number()]).optional().nullable(),
              image: z.string().optional().nullable(),
            }),
          )
          .optional(),
        premium_unlocked: z.boolean().optional(),
        poster_media: z.array(z.record(z.unknown())).optional(),
        poster_bg_urls: z.array(z.string()).optional(),
        poster_bg_url: z.string().nullable().optional(),
        yt_source: z.string().max(400).optional().nullable(),
        yt_enabled: z.boolean().optional(),
        yt_products: z.record(z.unknown()).optional(),
        ig_source: z.string().max(400).optional().nullable(),
        ig_enabled: z.boolean().optional(),
        ig_products: z.record(z.unknown()).optional(),
        pin_source: z.string().max(400).optional().nullable(),
        pin_enabled: z.boolean().optional(),
        pin_products: z.record(z.unknown()).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return zodFail(res, parsed.error);
    const sb = client();
    const extraLinks = parsed.data.extra_links;
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const d = parsed.data;
    for (const key of [
      "play_store_enabled",
      "payment_enabled",
      "payment_provider",
      "payment_upi_id",
      "payment_label",
      "digital_shop_enabled",
      "digital_shop_url",
      "premium_unlocked",
      "poster_bg_url",
      "yt_source",
      "yt_enabled",
      "ig_source",
      "ig_enabled",
      "pin_source",
      "pin_enabled",
    ] as const) {
      if (d[key] !== undefined) payload[key] = d[key];
    }
    if (d.payment_amount_inr !== undefined) {
      payload.payment_amount_inr = d.payment_amount_inr === "" ? null : Number(d.payment_amount_inr) || null;
    }
    if (extraLinks !== undefined) payload.extra_links = JSON.stringify(extraLinks);
    if (d.poster_media !== undefined) {
      const media = d.poster_media.map((item) => {
        const src = typeof item.src === "string" ? item.src : "";
        if (src.startsWith("data:") && src.length > 180_000) {
          return { ...item, src: "", poster: item.poster ?? null };
        }
        return item;
      });
      payload.poster_media = JSON.stringify(media);
    }
    if (d.poster_bg_urls !== undefined) payload.poster_bg_urls = JSON.stringify(d.poster_bg_urls);
    if (d.yt_products !== undefined) payload.yt_products = JSON.stringify(d.yt_products);
    if (d.ig_products !== undefined) payload.ig_products = JSON.stringify(d.ig_products);
    if (d.pin_products !== undefined) payload.pin_products = JSON.stringify(d.pin_products);
    if (sb) {
      const { data: project } = await sb
        .from("qr_projects")
        .select("id, is_paid")
        .eq("id", id)
        .eq("user_id", req.userId!)
        .maybeSingle();
      if (!project) return fail(res, 404, "project not found");
      const existing = await sb
        .from("merchant_link_settings")
        .select("id")
        .eq("user_id", req.userId!)
        .eq("project_id", id)
        .maybeSingle();
      const row = {
        ...payload,
        user_id: req.userId,
        project_id: id,
        premium_unlocked: parsed.data.premium_unlocked === true || !!(project as { is_paid?: boolean }).is_paid,
      };
      const saved = existing.data?.id
        ? await sb.from("merchant_link_settings").update(row).eq("id", existing.data.id).select("*").maybeSingle()
        : await sb.from("merchant_link_settings").insert(row).select("*").maybeSingle();
      const savedRow = Array.isArray(saved.data) ? saved.data[0] : saved.data;
      if (saved.error || !savedRow) {
        console.error("[links] save failed:", saved.error?.message ?? "no row");
        return fail(res, 500, "Link settings save nahi ho payi.");
      }
      const extra = (savedRow as { extra_links?: unknown }).extra_links;
      return ok(res, {
        settings: {
          ...defaultLinkSettings(),
          ...savedRow,
          extra_links: jsonValue(extra, extraLinks ?? []),
          poster_media: jsonValue((savedRow as { poster_media?: unknown }).poster_media, d.poster_media ?? []),
          yt_products: jsonValue((savedRow as { yt_products?: unknown }).yt_products, d.yt_products ?? {}),
          ig_products: jsonValue((savedRow as { ig_products?: unknown }).ig_products, d.ig_products ?? {}),
          pin_products: jsonValue((savedRow as { pin_products?: unknown }).pin_products, d.pin_products ?? {}),
          payment_enabled: !!(savedRow as { payment_enabled?: boolean }).payment_enabled,
        },
      });
    }
    const prev = memLinks.get(`${req.userId}:${id}`) ?? defaultLinkSettings();
    const next = { ...prev, ...parsed.data, extra_links: extraLinks ?? prev.extra_links };
    memLinks.set(`${req.userId}:${id}`, next);
    return ok(res, { settings: next, seeded: true });
  }),
);

growRouter.get(
  "/youtube-feed",
  requireAuth,
  asyncHandler(async (req, res) => {
    const source = String(req.query.source ?? "").trim();
    if (!source) return fail(res, 400, "Channel ID / playlist link daalein");
    try {
      const videos = await youtubeFeedFromSource(source);
      if (!videos.length) return fail(res, 404, "YouTube se videos nahi mili — @handle, UC… ya playlist link check karein");
      return ok(res, { videos });
    } catch (err) {
      console.error("[youtube-feed]", err instanceof Error ? err.message : err);
      const stale = feedCache.get(feedKey(source));
      if (stale?.videos.length) return ok(res, { videos: stale.videos, stale: true });
      return fail(res, 502, "YouTube sync fail hua — dobara Sync dabayein");
    }
  }),
);

export const growMem = { memProducts, memOrders, memProjects };
