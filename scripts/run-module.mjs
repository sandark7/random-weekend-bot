import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [builtPath, sourcePath] = process.argv.slice(2);

if (!builtPath || !sourcePath) {
  console.error("Usage: node scripts/run-module.mjs <built-js> <source-ts>");
  process.exit(2);
}

const isProduction = process.env.NODE_ENV === "production";
const args = isProduction && existsSync(builtPath) ? [builtPath] : ["--import", "tsx", sourcePath];
const result = spawnSync(process.execPath, args, {
  env: process.env,
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
