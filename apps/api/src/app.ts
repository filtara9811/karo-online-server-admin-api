import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env, hasDatabase, hasServiceRole } from "./config/env.js";
import { fail, ok } from "./lib/respond.js";
import { authRouter } from "./modules/auth.js";
import { meRouter } from "./modules/me.js";
import { quickRouter } from "./modules/quick.js";
import { leadsRouter } from "./modules/leads.js";
import { adminRouter } from "./modules/admin.js";
import { paymentsRouter } from "./modules/payments.js";
import { mapsRouter } from "./modules/maps.js";
import { pushRouter } from "./modules/push.js";
import { staffRouter } from "./modules/staff.js";
import { cmsRouter } from "./modules/cms.js";
import { adminScanRouter, scansRouter } from "./modules/scans.js";
import { shopsRouter } from "./modules/shops.js";
import { growRouter } from "./modules/grow.js";
import { webhooksRouter } from "./modules/webhooks.js";
import { mountStaticSites } from "./lib/static-site.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      frameguard: false,
    }),
  );
  app.use(
    cors({
      origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(",").map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
  app.use(
    express.json({
      limit: "2mb",
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    ok(res, { status: "up", service_role: hasServiceRole(), postgres: hasDatabase() });
  });
  app.get("/v1/health", (_req, res) => {
    ok(res, { status: "up", service_role: hasServiceRole(), postgres: hasDatabase() });
  });

  app.use("/v1/auth", authRouter);
  app.use("/v1/me", meRouter);
  app.use("/v1/quick", quickRouter);
  app.use("/v1/leads", leadsRouter);
  app.use("/v1/admin", adminRouter);
  app.use("/v1/admin/scan-insights", adminScanRouter);
  app.use("/v1/payments", paymentsRouter);
  app.use("/v1/maps", mapsRouter);
  app.use("/v1/push", pushRouter);
  app.use("/v1/staff", staffRouter);
  app.use("/v1/cms", cmsRouter);
  app.use("/v1/scans", scansRouter);
  app.use("/v1/shops", shopsRouter);
  app.use("/v1/grow", growRouter);
  app.use("/api/public", webhooksRouter);

  mountStaticSites(app);

  app.use((_req, res) => {
    fail(res, 404, "Not found");
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Internal server error";
    if (message === "SUPABASE_SERVICE_ROLE_KEY missing") {
      fail(res, 503, message);
      return;
    }
    console.error("[api]", err);
    fail(res, 500, message);
  });

  return app;
}
