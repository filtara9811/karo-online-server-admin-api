import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(apiRoot, "public");

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function buildApp(name) {
  const root = path.resolve(apiRoot, `../${name}`);
  if (!existsSync(path.join(root, "package.json"))) {
    console.warn(`[bundle] skip ${name} — not in this deploy`);
    return null;
  }
  run("npm", ["install"], root);
  run("npm", ["run", "build"], root);
  const dist = path.join(root, "dist");
  if (!existsSync(path.join(dist, "index.html"))) {
    console.error(`[bundle] ${name} dist/index.html missing`);
    process.exit(1);
  }
  return dist;
}

mkdirSync(publicDir, { recursive: true });

const adminDist = buildApp("admin");
if (adminDist) {
  const dest = path.join(publicDir, "admin");
  rmSync(dest, { recursive: true, force: true });
  cpSync(adminDist, dest, { recursive: true });
  console.log(`[bundle] admin → ${dest}`);
}

const webDist = buildApp("web");
if (webDist) {
  for (const name of readdirSync(webDist)) {
    if (name === "admin") continue;
    const dest = path.join(publicDir, name);
    rmSync(dest, { recursive: true, force: true });
    cpSync(path.join(webDist, name), dest, { recursive: true });
  }
  console.log(`[bundle] web → ${publicDir}`);
}
