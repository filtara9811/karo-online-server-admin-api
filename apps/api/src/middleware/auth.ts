import type { NextFunction, Request, Response } from "express";
import { createUserClient, getServiceRoleClient, tryServiceRole } from "../lib/supabase.js";
import { fail, serviceUnavailable } from "../lib/respond.js";
import { hasServiceRole } from "../config/env.js";

export function readBearer(req: Request): string | null {
  const header = req.headers.authorization ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = readBearer(req);
  if (!token) {
    fail(res, 401, "Unauthorized: Bearer token required");
    return;
  }

  const userClient = createUserClient(token);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) {
    fail(res, 401, "Unauthorized: Invalid token");
    return;
  }

  req.userId = data.user.id;
  req.accessToken = token;
  req.userClient = userClient;
  req.authUser = data.user;
  next();
}

export function requireServiceRole(req: Request, res: Response, next: NextFunction) {
  if (!hasServiceRole()) {
    serviceUnavailable(res);
    return;
  }
  void req;
  next();
}

export function adminFromRequest() {
  const client = tryServiceRole();
  if (!client) throw new Error("DATABASE_URL missing — DigitalOcean Postgres is required");
  return client;
}

export { getServiceRoleClient };
