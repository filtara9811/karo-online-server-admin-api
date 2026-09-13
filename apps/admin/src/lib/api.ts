import { supabase } from "./supabase";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type AdminMe = {
  email?: string | null;
  roles?: string[];
  role?: string;
  user?: { id?: string; email?: string | null };
};

export function apiBase() {
  const envBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
  if (import.meta.env.DEV) return "";
  if (typeof window !== "undefined" && /:(4000|5173|5174)$/.test(window.location.origin)) {
    return "";
  }
  return envBase;
}

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const base = apiBase();
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("API se connect nahi ho paya. Server check kariye.", 0);
  }

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
    const msg =
      (typeof rec.error === "string" && rec.error) ||
      (typeof rec.message === "string" && rec.message) ||
      `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }

  if ("data" in rec) return rec.data as T;
  return body as T;
}

export function asList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const k of [
      "data",
      "rows",
      "items",
      "results",
      "leads",
      "customers",
      "vendors",
      "staff",
      "users",
      "gateways",
      "providers",
    ]) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
  }
  return [];
}

export function asRecord(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) {
      return o.data as Record<string, unknown>;
    }
    return o;
  }
  return {};
}

export function str(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v);
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

export const ADMIN_ROLES = ["super_admin", "admin", "moderator", "support"] as const;

export function extractRoles(me: AdminMe | Record<string, unknown> | null | undefined): string[] {
  if (!me || typeof me !== "object") return [];
  const rec = me as Record<string, unknown>;
  if (Array.isArray(rec.roles)) return rec.roles.map(String);
  if (typeof rec.role === "string") return [rec.role];
  if (rec.user && typeof rec.user === "object") {
    const u = rec.user as Record<string, unknown>;
    if (Array.isArray(u.roles)) return u.roles.map(String);
    if (typeof u.role === "string") return [u.role];
  }
  return [];
}

export function isAdminRoles(roles: string[]): boolean {
  return roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r));
}
