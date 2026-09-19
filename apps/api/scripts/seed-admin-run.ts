import { seedBootstrapAdmin } from "../src/lib/seed-admin.js";

seedBootstrapAdmin()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
