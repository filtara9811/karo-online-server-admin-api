import express, { Router } from "express";
import { z } from "zod";
import { asyncHandler, fail, ok } from "../lib/respond.js";
import { getPool } from "../lib/pg-client.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureVendorSchema } from "../lib/apply-vendor-schema.js";

/** Small images (shop photos, KYC documents, product pictures) stored in DigitalOcean Postgres. */
export const mediaRouter = Router();

const MAX_BYTES = 6 * 1024 * 1024;

mediaRouter.post(
  "/",
  requireAuth,
  express.raw({ type: ["image/*", "application/octet-stream"], limit: MAX_BYTES }),
  asyncHandler(async (req, res) => {
    const body = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(body) || body.length === 0) return fail(res, 400, "Send the image bytes as the request body");
    const mime = String(req.headers["content-type"] ?? "image/jpeg").split(";")[0];
    const kind = typeof req.query.kind === "string" ? req.query.kind.slice(0, 40) : null;
    await ensureVendorSchema();
    const { rows } = await getPool().query(
      `insert into public.media_files (user_id, kind, mime, bytes, data) values ($1, $2, $3, $4, $5) returning id`,
      [req.userId, kind, mime === "application/octet-stream" ? "image/jpeg" : mime, body.length, body],
    );
    const id = rows[0].id as string;
    const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0];
    return ok(res, { id, url: `${proto}://${req.get("host")}/v1/media/${id}` }, 201);
  }),
);

mediaRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return fail(res, 400, "Invalid media id");
    await ensureVendorSchema();
    const { rows } = await getPool().query(`select mime, data from public.media_files where id = $1`, [id.data]);
    if (!rows[0]) return fail(res, 404, "Not found");
    res.setHeader("Content-Type", rows[0].mime);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(rows[0].data);
  }),
);
