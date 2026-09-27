import { Router } from "express";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { getPool } from "../lib/pg-client.js";
import {
  FormSubmitSchema,
  SlugSchema,
  getBlogPost,
  getLegalPage,
  getMarketingPage,
  getPublicForm,
  getSiteBundle,
  listBlogPosts,
  submitWebForm,
} from "../lib/cms.js";

export const cmsRouter = Router();

const PUBLIC_SETTINGS = ["welcome_video", "vendor_onboarding_video", "social_links", "auth_bg_video"];

cmsRouter.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const asked = String(req.query.keys ?? "").split(",").map((k) => k.trim()).filter((k) => PUBLIC_SETTINGS.includes(k));
    const keys = asked.length ? asked : PUBLIC_SETTINGS;
    const { rows } = await getPool().query(`select key, value from public.app_settings where key = any($1::text[])`, [keys]);
    return ok(res, { settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  }),
);

cmsRouter.get(
  "/site",
  asyncHandler(async (_req, res) => {
    return ok(res, await getSiteBundle());
  }),
);

cmsRouter.get(
  "/page/:slug",
  asyncHandler(async (req, res) => {
    const parsed = SlugSchema.safeParse({ slug: req.params.slug });
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await getMarketingPage(parsed.data.slug));
  }),
);

cmsRouter.get(
  "/legal/:slug",
  asyncHandler(async (req, res) => {
    const parsed = SlugSchema.safeParse({ slug: req.params.slug });
    if (!parsed.success) return zodFail(res, parsed.error);
    const page = await getLegalPage(parsed.data.slug);
    if (!page) return fail(res, 404, "Page not found");
    return ok(res, { page });
  }),
);

cmsRouter.get(
  "/blog",
  asyncHandler(async (_req, res) => {
    return ok(res, { posts: await listBlogPosts() });
  }),
);

cmsRouter.get(
  "/blog/:slug",
  asyncHandler(async (req, res) => {
    const parsed = SlugSchema.safeParse({ slug: req.params.slug });
    if (!parsed.success) return zodFail(res, parsed.error);
    const post = await getBlogPost(parsed.data.slug);
    if (!post) return fail(res, 404, "Post not found");
    return ok(res, { post });
  }),
);

cmsRouter.get(
  "/forms/:slug",
  asyncHandler(async (req, res) => {
    const parsed = SlugSchema.safeParse({ slug: req.params.slug });
    if (!parsed.success) return zodFail(res, parsed.error);
    const form = await getPublicForm(parsed.data.slug);
    if (!form) return fail(res, 404, "Form not found");
    return ok(res, { form });
  }),
);

cmsRouter.post(
  "/forms/:slug/submit",
  asyncHandler(async (req, res) => {
    const slug = SlugSchema.safeParse({ slug: req.params.slug });
    if (!slug.success) return zodFail(res, slug.error);
    const parsed = FormSubmitSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    return ok(res, await submitWebForm(slug.data.slug, parsed.data));
  }),
);
