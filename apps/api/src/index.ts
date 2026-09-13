import { env, hasServiceRole } from "./config/env.js";
import { createApp } from "./app.js";
import { seedBootstrapAdmin } from "./lib/seed-admin.js";

const app = createApp();

app.listen(env.port, () => {
  console.log(
    `[karo-api] listening on :${env.port}  service_role=${hasServiceRole() ? "yes" : "missing"}`,
  );
  seedBootstrapAdmin().catch((e) => console.warn("[seed-admin]", e));
});
