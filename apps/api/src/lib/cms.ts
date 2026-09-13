import { z } from "zod";
import { getServiceRoleClient } from "./supabase.js";
import { tableMissing } from "./memory.js";

export const SlugSchema = z.object({
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
});

export const FormSubmitSchema = z.object({
  data: z.record(z.string().max(128), z.unknown()),
  source_page: z.string().max(200).optional(),
  honeypot: z.string().max(200).optional(),
});

async function mem() {
  return import("./memory.js");
}

export async function getMarketingPage(slug: string) {
  try {
    const admin = getServiceRoleClient();
    const [pageR, heroR, blocksR, faqsR, offerR] = await Promise.all([
      admin.from("web_pages").select("*").eq("slug", slug).eq("is_active", true).maybeSingle(),
      admin.from("web_hero_sections").select("*").eq("page_slug", slug).eq("is_active", true).maybeSingle(),
      admin.from("web_content_blocks").select("*").eq("page_slug", slug).eq("is_active", true).order("sort_order"),
      admin.from("web_faqs").select("*").eq("page_slug", slug).eq("is_active", true).order("sort_order"),
      admin.from("web_offers").select("*").eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (tableMissing(pageR.error) || tableMissing(heroR.error)) {
      return (await mem()).memCmsPage(slug);
    }
    return {
      page: pageR.data,
      hero: heroR.data,
      blocks: blocksR.data ?? [],
      faqs: faqsR.data ?? [],
      offer: offerR.data,
    };
  } catch {
    return (await mem()).memCmsPage(slug);
  }
}

export async function listBlogPosts() {
  try {
    const admin = getServiceRoleClient();
    const { data, error } = await admin
      .from("web_blog_posts")
      .select("id, slug, title, excerpt, cover_image_url, cover_image_alt, tags, author_name, published_at, reading_minutes")
      .eq("is_published", true)
      .order("published_at", { ascending: false });
    if (error) {
      if (tableMissing(error)) return (await mem()).memBlogPosts();
      throw new Error(error.message);
    }
    return data ?? [];
  } catch (err) {
    if (err instanceof Error && !/missing|schema|relation|table/i.test(err.message) && err.message !== "SUPABASE_SERVICE_ROLE_KEY missing") {
      throw err;
    }
    return (await mem()).memBlogPosts();
  }
}

export async function getBlogPost(slug: string) {
  try {
    const admin = getServiceRoleClient();
    const { data, error } = await admin.from("web_blog_posts").select("*").eq("slug", slug).eq("is_published", true).maybeSingle();
    if (error) {
      if (tableMissing(error)) return (await mem()).memBlogPost(slug);
      throw new Error(error.message);
    }
    return data;
  } catch {
    return (await mem()).memBlogPost(slug);
  }
}

export async function getLegalPage(slug: string) {
  try {
    const admin = getServiceRoleClient();
    const { data, error } = await admin.from("legal_pages").select("*").eq("slug", slug).maybeSingle();
    if (error) {
      if (tableMissing(error)) return (await mem()).memLegalPage(slug);
      throw new Error(error.message);
    }
    return data;
  } catch {
    return (await mem()).memLegalPage(slug);
  }
}

export async function getSiteBundle() {
  try {
    const admin = getServiceRoleClient();
    const [offer, testimonials, pricing, faqs, apk] = await Promise.all([
      admin.from("web_offers").select("*").eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("web_testimonials").select("*").eq("is_active", true),
      admin.from("web_pricing_plans").select("*"),
      admin.from("web_faqs").select("*").eq("is_active", true).order("sort_order"),
      admin.from("web_apk_releases").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (tableMissing(offer.error) || tableMissing(testimonials.error)) {
      return (await mem()).memSiteBundle();
    }
    return {
      offer: offer.data,
      testimonials: testimonials.data ?? [],
      pricing: pricing.data ?? [],
      faqs: faqs.data ?? [],
      apk: apk.data,
    };
  } catch {
    return (await mem()).memSiteBundle();
  }
}

export async function getPublicForm(slug: string) {
  try {
    const admin = getServiceRoleClient();
    const { data, error } = await admin.from("web_forms").select("id, slug, title, fields, is_active").eq("slug", slug).eq("is_active", true).maybeSingle();
    if (error) {
      if (tableMissing(error)) {
        const { memTableList } = await mem();
        return memTableList("web_forms").find((f) => f.slug === slug && f.is_active !== false) ?? null;
      }
      throw new Error(error.message);
    }
    return data;
  } catch {
    const { memTableList } = await mem();
    return memTableList("web_forms").find((f) => f.slug === slug && f.is_active !== false) ?? null;
  }
}

export async function submitWebForm(slug: string, input: z.infer<typeof FormSubmitSchema>) {
  if (input.honeypot && input.honeypot.length > 0) return { ok: true };
  try {
    const admin = getServiceRoleClient();
    const { data: form, error } = await admin.from("web_forms").select("id, fields").eq("slug", slug).eq("is_active", true).maybeSingle();
    if (error && tableMissing(error)) {
      const memd = await mem();
      const result = memd.memSubmitForm(slug, input.data, input.source_page);
      if (!result.ok) throw new Error(result.error);
      return { ok: true };
    }
    if (!form) throw new Error("Form not found");

    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input.data)) {
      cleaned[k] = typeof v === "string" ? v.slice(0, 5000) : v;
    }

    const { error: insErr } = await admin.from("web_form_submissions").insert([
      { form_id: form.id, data: cleaned, source_page: input.source_page ?? null },
    ]);
    if (insErr) {
      if (tableMissing(insErr)) {
        const memd = await mem();
        memd.memSubmitForm(slug, cleaned, input.source_page);
        return { ok: true };
      }
      throw new Error(insErr.message);
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message === "Form not found") throw err;
    const memd = await mem();
    const result = memd.memSubmitForm(slug, input.data, input.source_page);
    if (!result.ok) throw new Error(result.error);
    return { ok: true };
  }
}
