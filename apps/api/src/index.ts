import { env, hasServiceRole } from "./config/env.js";
import app from "./app.js";
import { seedBootstrapAdmin, seedSmsGateways } from "./lib/seed-admin.js";
import { applyGrowSchema } from "./lib/apply-grow-schema.js";

export default app;

function bootLocal() {
  app.listen(env.port, () => {
    console.log(
      `[karo-api] listening on :${env.port}  db=${env.databaseUrl ? "postgres" : "none"}  service_role=${hasServiceRole() ? "yes" : "missing"}`,
    );
    seedBootstrapAdmin().catch((e) => console.warn("[seed-admin]", e));
    seedSmsGateways().catch((e) => console.warn("[seed-sms]", e));
    applyGrowSchema()
      .then(() => console.log("[grow-schema] ready"))
      .catch((e) => console.warn("[grow-schema]", e));
  });
}

if (!process.env.VERCEL) {
  bootLocal();
}
