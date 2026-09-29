import { env } from "../config/env.js";

export type YtThumb = { id: string; title: string; thumbnail: string };

function ytThumb(id: string, title?: string | null): YtThumb {
  return { id, title: title || "YouTube video", thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg` };
}

const YT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-IN,en;q=0.9",
};

const INVIDIOUS = ["https://inv.nadeko.net", "https://yewtu.be", "https://invidious.nerdvpn.de"];
export const feedCache = new Map<string, { at: number; videos: YtThumb[] }>();
const handleCache = new Map<string, string>();
const FEED_TTL_MS = 30 * 60 * 1000;

export function feedKey(source: string) {
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
          .flatMap((v) => (v.videoId ? [ytThumb(v.videoId, v.title)] : []))
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
  return (j.items ?? []).flatMap((it) => {
    const id = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
    return id ? [ytThumb(id, it.snippet?.title)] : [];
  });
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

export async function youtubeFeedFromSource(source: string): Promise<YtThumb[]> {
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
