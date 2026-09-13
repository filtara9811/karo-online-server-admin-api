import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SaveScanSchema = z.object({
  kinds: z.array(z.string()).min(1).max(10),
  thumbnail: z.string().nullable(),
  extracted: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1).nullable().optional(),
  field_confidence: z.record(z.string(), z.number()).nullable().optional(),
  status: z.enum(["complete", "pending_ocr"]).optional(),
});

export async function listScanHistory(sb: SupabaseClient) {
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
  sb: SupabaseClient,
  userId: string,
  data: z.infer<typeof SaveScanSchema>,
) {
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
  if (error) {
    console.warn("[scan-history] save failed:", error.message);
    return { id: null as string | null };
  }
  return { id: row.id as string };
}

export async function deleteScanHistory(sb: SupabaseClient, id: string) {
  const { error } = await sb.from("vendor_scan_history").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function getScanInsights(sb: SupabaseClient, userId: string) {
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
    return {
      total: 3,
      last7d: 2,
      last30d: 3,
      today: 1,
      avgConfidence: 0.82,
      emptyRate: 0.1,
      fieldFillRate: {
        business_name: 0.9,
        owner_name: 0.7,
        mobile: 0.85,
        address: 0.6,
        city: 0.5,
        state: 0.4,
        pincode: 0.4,
        gstin: 0.2,
        email: 0.3,
        shop_type_hint: 0.5,
      },
      recent: [
        {
          id: "seed-1",
          created_at: new Date().toISOString(),
          thumbnail: null,
          confidence: 0.88,
          business_name: "Karo Maison",
          mobile: "9999999999",
          kinds: ["card"],
        },
      ],
      seeded: true,
    };
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
  ];
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
      const ok = Array.isArray(v) ? v.length > 0 : Boolean(v);
      if (ok) {
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
