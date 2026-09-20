import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminRoot = path.resolve(apiRoot, "../admin");
const dest = path.join(apiRoot, "public/admin");

if (!existsSync(path.join(adminRoot, "package.json"))) {
  console.warn("[bundle-admin] skip — ../admin not in this deploy");
  process.exit(0);
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npm", ["install"], adminRoot);
run("npm", ["run", "build"], adminRoot);

const dist = path.join(adminRoot, "dist");
if (!existsSync(path.join(dist, "index.html"))) {
  console.error("[bundle-admin] admin dist/index.html missing");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(path.dirname(dest), { recursive: true });
cpSync(dist, dest, { recursive: true });
console.log(`[bundle-admin] admin UI → ${dest}`);
