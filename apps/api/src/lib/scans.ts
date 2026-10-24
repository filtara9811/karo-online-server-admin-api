import { z } from "zod";
import type { DbClient } from "./pg-client.js";
import { ensureVendorSchema } from "./apply-vendor-schema.js";

export const SaveScanSchema = z.object({
  kinds: z.array(z.string()).min(1).max(10),
  thumbnail: z.string().nullable(),
  extracted: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1).nullable().optional(),
  field_confidence: z.record(z.string(), z.number()).nullable().optional(),
  status: z.enum(["complete", "pending_ocr"]).optional(),
});

const TRACK = [
  "business_name",
  "owner_name",
  "mobile",
  "address",
  "city",
  "state",
  "pincode",
  "gstin",
  "email",
  "shop_type_hint",
] as const;

function emptyInsights() {
  const fieldFillRate: Record<string, number> = {};
  for (const k of TRACK) fieldFillRate[k] = 0;
  return {
    total: 0,
    last7d: 0,
    last30d: 0,
    today: 0,
    avgConfidence: null as number | null,
    emptyRate: 0,
    fieldFillRate,
    recent: [] as Array<{
      id: string;
      created_at: string;
      thumbnail: string | null;
      confidence: number | null;
      business_name: string | null;
      mobile: string | null;
      kinds: string[];
    }>,
  };
}

export async function listScanHistory(sb: DbClient) {
  await ensureVendorSchema();
  const { data, error } = await sb
    .from("vendor_scan_history")
    .select("id, kinds, thumbnail, extracted, confidence, field_confidence, status, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.warn("[scan-history] list failed:", error.message);
    return [];
  }
  return data ?? [];
}

export async function saveScanHistory(
  sb: DbClient,
  userId: string,
  data: z.infer<typeof SaveScanSchema>,
) {
  await ensureVendorSchema();
  const { data: row, error } = await sb
    .from("vendor_scan_history")
    .insert({
      user_id: userId,
      kinds: data.kinds,
      thumbnail: data.thumbnail,
      extracted: data.extracted,
      confidence: data.confidence ?? null,
      field_confidence: data.field_confidence ?? null,
      status: data.status ?? "complete",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (!row?.id) throw new Error("Scan history insert returned no id");
  return { id: row.id as string };
}

export async function deleteScanHistory(sb: DbClient, id: string) {
  await ensureVendorSchema();
  const { error } = await sb.from("vendor_scan_history").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function getScanInsights(sb: DbClient, userId: string) {
  await ensureVendorSchema();
  try {
    const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (isAdmin === false) throw new Error("Forbidden");
  } catch (err) {
    if (err instanceof Error && err.message === "Forbidden") throw err;
  }

  const { data, error } = await sb
    .from("vendor_scan_history")
    .select("id, created_at, thumbnail, confidence, extracted, kinds")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.warn("[scan-insights] query failed:", error.message);
    return emptyInsights();
  }

  const rows = (data ?? []) as Array<{
    id: string;
    created_at: string;
    thumbnail: string | null;
    confidence: number | null;
    extracted: Record<string, unknown> | null;
    kinds: string[] | null;
  }>;

  const now = Date.now();
  const D = 24 * 60 * 60 * 1000;
  const in7 = now - 7 * D;
  const in30 = now - 30 * D;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  let confSum = 0;
  let confCount = 0;
  let empty = 0;
  const fieldHit: Record<string, number> = {};
  for (const k of TRACK) fieldHit[k] = 0;

  for (const r of rows) {
    if (typeof r.confidence === "number") {
      confSum += r.confidence;
      confCount++;
    }
    const ex = r.extracted ?? {};
    let hasAny = false;
    for (const k of TRACK) {
      const v = ex[k];
      const filled = Array.isArray(v) ? v.length > 0 : Boolean(v);
      if (filled) {
        fieldHit[k]++;
        hasAny = true;
      }
    }
    if (!hasAny) empty++;
  }

  const fieldFillRate: Record<string, number> = {};
  const denom = Math.max(1, rows.length);
  for (const k of TRACK) fieldFillRate[k] = fieldHit[k] / denom;

  const recent = rows.slice(0, 15).map((r) => {
    const ex = r.extracted ?? {};
    return {
      id: r.id,
      created_at: r.created_at,
      thumbnail: r.thumbnail,
      confidence: r.confidence,
      business_name: (ex.business_name as string) ?? null,
      mobile: (ex.mobile as string) ?? null,
      kinds: r.kinds ?? [],
    };
  });

  return {
    total: rows.length,
    last7d: rows.filter((r) => new Date(r.created_at).getTime() >= in7).length,
    last30d: rows.filter((r) => new Date(r.created_at).getTime() >= in30).length,
    today: rows.filter((r) => new Date(r.created_at).getTime() >= startOfToday.getTime()).length,
    avgConfidence: confCount > 0 ? confSum / confCount : null,
    emptyRate: rows.length ? empty / rows.length : 0,
    fieldFillRate,
    recent,
  };
}
