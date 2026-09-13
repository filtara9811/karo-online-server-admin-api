const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (!res.ok || rec.ok === false) {
    throw new ApiError(typeof rec.error === "string" ? rec.error : `Request failed (${res.status})`, res.status);
  }
  if ("data" in rec) return rec.data as T;
  return body as T;
}

export function unwrapRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const rec = raw as Record<string, unknown>;
  if (rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) && rec.name == null) {
    return rec.data as Record<string, unknown>;
  }
  return rec;
}

export function str(v: unknown, fallback = "") {
  return v == null ? fallback : String(v);
}

export function asList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const k of ["posts", "products", "rows", "items", "faqs", "testimonials", "pricing"]) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
  }
  return [];
}
