export type LatLng = { lat: number; lng: number };

export function kmBetween(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 10) / 10;
}

export function parseListQuery(query: Record<string, unknown>) {
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 100));
  const offset = Math.max(0, Number(query.offset) || 0);
  const q = typeof query.q === "string" ? query.q.trim() : "";
  return { limit, offset, q };
}

export function asJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}
