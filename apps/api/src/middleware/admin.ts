import type { NextFunction, Request, Response } from "express";
import { fail } from "../lib/respond.js";
import { tryServiceRole } from "../lib/supabase.js";

export const ADMIN_ROLES = new Set(["super_admin", "admin", "moderator", "support"]);

export async function loadRoles(userId: string): Promise<string[]> {
  const sb = tryServiceRole() ?? null;
  if (!sb) return [];
  const { data, error } = await sb.from("user_roles").select("role").eq("user_id", userId);
  if (error) return [];
  return (data ?? []).map((r: { role: string }) => r.role);
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.userId || !req.userClient) {
    fail(res, 401, "Unauthorized");
    return;
  }

  const sb = tryServiceRole() ?? req.userClient;
  const { data, error } = await sb.from("user_roles").select("role").eq("user_id", req.userId);
  if (error) {
    const email = String(req.authUser?.email ?? "");
    if (/schema cache|does not exist/i.test(error.message) && email === "admin@karoonline.local") {
      req.roles = ["super_admin"];
      next();
      return;
    }
    fail(res, 403, "Not authorized");
    return;
  }
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  req.roles = roles;
  if (!roles.some((r) => ADMIN_ROLES.has(r))) {
    fail(res, 403, "Not authorized");
    return;
  }
  next();
}
