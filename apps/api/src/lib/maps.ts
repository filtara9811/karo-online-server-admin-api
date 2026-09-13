import { z } from "zod";
import { env } from "../config/env.js";
import { createAnonClient, tryServiceRole } from "./supabase.js";

const BASE = "https://maps.googleapis.com/maps/api";

let cachedKey: { value: string; at: number } | null = null;

async function key(): Promise<string> {
  if (env.googleMapsServerKey) return env.googleMapsServerKey;
  if (cachedKey && Date.now() - cachedKey.at < 60_000) return cachedKey.value;
  const sb = tryServiceRole() ?? createAnonClient();
  const { data } = await sb
    .from("maps_services")
    .select("api_key, rest_key, map_sdk_key, is_active, provider, priority")
    .eq("is_active", true)
    .order("priority");
  const rows = data ?? [];
  const google = rows.find((r) => String(r.provider) === "google_maps") ?? rows[0];
  const value = String(google?.api_key || google?.rest_key || google?.map_sdk_key || "").trim();
  if (!value) throw new Error("No Maps API key in maps_services");
  cachedKey = { value, at: Date.now() };
  return value;
}

export const LatLngSchema = z.object({ lat: z.number(), lng: z.number() });

export const GeocodeSchema = z.object({ address: z.string().min(1).max(500) });
export const ReverseSchema = LatLngSchema;
export const DistanceSchema = z.object({
  origin: LatLngSchema,
  destinations: z.array(LatLngSchema).min(1).max(25),
});
export const PlacesSchema = z.object({
  input: z.string().min(1).max(200),
  sessionToken: z.string().max(64).optional(),
  bias: LatLngSchema.nullable().optional(),
});
export const PlaceDetailsSchema = z.object({
  placeId: z.string().min(1).max(255),
  sessionToken: z.string().max(64).optional(),
});
export const DirectionsSchema = z.object({
  origin: LatLngSchema,
  destination: LatLngSchema,
});

export async function reverseGeocode(data: z.infer<typeof ReverseSchema>) {
  const url = `${BASE}/geocode/json?latlng=${data.lat},${data.lng}&language=en&key=${await key()}`;
  const r = await fetch(url);
  const j = (await r.json()) as { status: string; error_message?: string; results?: unknown[] };
  if (j.status !== "OK") {
    return { ok: false as const, status: j.status, error: j.error_message ?? null };
  }
  return { ok: true as const, results: j.results };
}

export async function geocode(data: z.infer<typeof GeocodeSchema>) {
  const url = `${BASE}/geocode/json?address=${encodeURIComponent(data.address)}&region=in&key=${await key()}`;
  const r = await fetch(url);
  const j = (await r.json()) as {
    status: string;
    error_message?: string;
    results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
  };
  if (j.status !== "OK" || !j.results?.[0]?.geometry?.location) {
    return { ok: false as const, status: j.status, error: j.error_message ?? null };
  }
  const loc = j.results[0].geometry.location;
  return { ok: true as const, lat: loc.lat, lng: loc.lng };
}

export async function distanceMatrix(data: z.infer<typeof DistanceSchema>) {
  const dest = data.destinations.map((d) => `${d.lat},${d.lng}`).join("|");
  const url = `${BASE}/distancematrix/json?origins=${data.origin.lat},${data.origin.lng}&destinations=${encodeURIComponent(dest)}&mode=driving&units=metric&key=${await key()}`;
  const r = await fetch(url);
  const j = (await r.json()) as {
    status: string;
    error_message?: string;
    rows?: Array<{
      elements?: Array<{
        status?: string;
        distance?: { value: number; text: string };
        duration?: { value: number; text: string };
      }>;
    }>;
  };
  if (j.status !== "OK") {
    return { ok: false as const, status: j.status, error: j.error_message ?? null };
  }
  const row = j.rows?.[0]?.elements ?? [];
  const elements = row.map((e) =>
    e?.status === "OK"
      ? {
          distanceMeters: e.distance!.value,
          distanceText: e.distance!.text,
          durationSeconds: e.duration!.value,
          durationText: e.duration!.text,
        }
      : null,
  );
  return { ok: true as const, elements };
}

export async function placesAutocomplete(data: z.infer<typeof PlacesSchema>) {
  const params = new URLSearchParams({ input: data.input, components: "country:in", key: await key() });
  if (data.sessionToken) params.set("sessiontoken", data.sessionToken);
  if (data.bias) {
    params.set("location", `${data.bias.lat},${data.bias.lng}`);
    params.set("radius", "50000");
  }
  const r = await fetch(`${BASE}/place/autocomplete/json?${params}`);
  const j = (await r.json()) as {
    status: string;
    error_message?: string;
    predictions?: Array<{
      place_id: string;
      description: string;
      structured_formatting?: { main_text?: string; secondary_text?: string };
    }>;
  };
  if (j.status !== "OK" && j.status !== "ZERO_RESULTS") {
    return { ok: false as const, status: j.status, error: j.error_message ?? null };
  }
  const predictions = (j.predictions ?? []).map((p) => ({
    place_id: p.place_id,
    description: p.description,
    main_text: p.structured_formatting?.main_text ?? p.description,
    secondary_text: p.structured_formatting?.secondary_text ?? "",
  }));
  return { ok: true as const, predictions };
}

export async function placeDetails(data: z.infer<typeof PlaceDetailsSchema>) {
  const params = new URLSearchParams({
    place_id: data.placeId,
    fields: "formatted_address,geometry",
    key: await key(),
  });
  if (data.sessionToken) params.set("sessiontoken", data.sessionToken);
  const r = await fetch(`${BASE}/place/details/json?${params}`);
  const j = (await r.json()) as {
    status: string;
    error_message?: string;
    result?: { formatted_address?: string; geometry?: { location?: { lat: number; lng: number } } };
  };
  const result = j.result;
  if (j.status !== "OK" || !result?.geometry?.location) {
    return { ok: false as const, status: j.status, error: j.error_message ?? null };
  }
  return {
    ok: true as const,
    address: result.formatted_address ?? "",
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
  };
}

export async function directions(data: z.infer<typeof DirectionsSchema>) {
  const url = `${BASE}/directions/json?origin=${data.origin.lat},${data.origin.lng}&destination=${data.destination.lat},${data.destination.lng}&mode=driving&key=${await key()}`;
  const r = await fetch(url);
  const j = (await r.json()) as {
    status: string;
    error_message?: string;
    routes?: Array<{
      overview_polyline?: { points?: string };
      legs?: Array<{
        distance?: { text?: string };
        duration?: { text?: string };
        steps?: Array<{ html_instructions?: string; distance?: { text?: string }; duration?: { text?: string } }>;
      }>;
    }>;
  };
  const route = j.routes?.[0];
  const leg = route?.legs?.[0];
  if (j.status !== "OK" || !route || !leg) {
    return { ok: false as const, status: j.status, error: j.error_message ?? null };
  }
  return {
    ok: true as const,
    polyline: route.overview_polyline?.points ?? "",
    distanceText: leg.distance?.text ?? "",
    durationText: leg.duration?.text ?? "",
    steps: (leg.steps ?? []).map((s) => ({
      html: s.html_instructions ?? "",
      distance: s.distance?.text ?? "",
      duration: s.duration?.text ?? "",
    })),
  };
}
