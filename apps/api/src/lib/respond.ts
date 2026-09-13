import type { Response } from "express";
import { ZodError } from "zod";
import { SERVICE_ROLE_MISSING } from "../config/env.js";

export type ApiBody = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export function ok(res: Response, data?: unknown, status = 200): Response {
  const body: ApiBody = data === undefined ? { ok: true } : { ok: true, data };
  return res.status(status).json(body);
}

export function fail(res: Response, status: number, error: string, data?: unknown): Response {
  const body: ApiBody = data === undefined ? { ok: false, error } : { ok: false, error, data };
  return res.status(status).json(body);
}

export function serviceUnavailable(res: Response, message = SERVICE_ROLE_MISSING): Response {
  return fail(res, 503, message);
}

export function zodFail(res: Response, error: ZodError): Response {
  const message = error.issues.map((i) => i.message).join("; ") || "Invalid request";
  return fail(res, 400, message);
}

export function httpError(res: Response, err: unknown, fallback = "Internal server error"): Response {
  const message = err instanceof Error ? err.message : fallback;
  if (message === SERVICE_ROLE_MISSING) return serviceUnavailable(res);
  const status = /not authorized|forbidden/i.test(message)
    ? 403
    : /unauthorized|invalid token|missing token/i.test(message)
      ? 401
      : 500;
  return fail(res, status, message);
}

export function asyncHandler(
  fn: (req: import("express").Request, res: Response) => Promise<unknown>,
) {
  return (req: import("express").Request, res: Response, next: import("express").NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
