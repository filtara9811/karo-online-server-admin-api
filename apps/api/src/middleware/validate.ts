import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { zodFail } from "../lib/respond.js";

export function validate(schema: ZodType, source: "body" | "query" | "params" = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      zodFail(res, parsed.error);
      return;
    }
    (req as Request & Record<string, unknown>)[source] = parsed.data;
    next();
  };
}

export function parseBody<T>(schema: ZodType<T>, raw: unknown): T {
  return schema.parse(raw);
}
