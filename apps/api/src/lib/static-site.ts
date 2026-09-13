import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express, Request, Response } from "express";
import express from "express";
import { env } from "../config/env.js";
import { fetchPublicLanding } from "./shops.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function firstExisting(...candidates: string[]) {
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function webDist() {
  return firstExisting(
    path.resolve(here, "../../../../apps/web/dist"),
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(process.cwd(), "../../apps/web/dist"),
  );
}

function adminDist() {
  return firstExisting(
    path.resolve(here, "../../../../apps/admin/dist"),
    path.resolve(process.cwd(), "../admin/dist"),
    path.resolve(process.cwd(), "../../apps/admin/dist"),
  );
}

function injectMeta(html: string, meta: { title: string; description: string; url: string; image: string }) {
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}" />`,
    `<meta property="og:image" content="${escapeHtml(meta.image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
  ].join("\n    ");
  if (html.includes("</head>")) return html.replace("</head>", `    ${tags}\n  </head>`);
  return html;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

const LANDING = /^\/(s|q|c|r)\/([^/?#]+)/i;

async function sendWebIndex(req: Request, res: Response, indexPath: string) {
  let html = fs.readFileSync(indexPath, "utf8");
  const match = req.path.match(LANDING);
  if (match) {
    const kind = match[1].toLowerCase();
    const code = decodeURIComponent(match[2]);
    const payload = await fetchPublicLanding(code, null, kind);
    const name =
      payload && typeof payload === "object" && "name" in payload && payload.name
        ? String(payload.name)
        : code;
    const origin = env.publicSiteUrl.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`;
    html = injectMeta(html, {
      title: `${name} — Karo Online`,
      description: `Open ${name} on Karo Online. Videos, products and chat.`,
      url: `${origin}${req.originalUrl.split("?")[0]}`,
      image: `${origin}/api/public/share-image/${kind === "c" ? "card" : "qr"}/${encodeURIComponent(code)}`,
    });
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.removeHeader("X-Frame-Options");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.send(html);
}

export function mountStaticSites(app: Express) {
  const admin = adminDist();
  const web = webDist();

  if (admin) {
    app.use("/admin", express.static(admin, { index: false, maxAge: "1h" }));
    app.get(/^\/admin(?:\/.*)?$/, (_req, res) => {
      res.sendFile(path.join(admin, "index.html"));
    });
    console.log(`[karo-api] admin UI  ${admin}  → /admin`);
  }

  if (web) {
    app.use(express.static(web, { index: false, maxAge: "1h" }));
    app.get(/.*/, async (req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/v1") || req.path.startsWith("/api") || req.path.startsWith("/health") || req.path.startsWith("/admin")) {
        return next();
      }
      if (path.extname(req.path)) return next();
      try {
        await sendWebIndex(req, res, path.join(web, "index.html"));
      } catch (err) {
        next(err);
      }
    });
    console.log(`[karo-api] public web ${web}  → /`);
  }
}
