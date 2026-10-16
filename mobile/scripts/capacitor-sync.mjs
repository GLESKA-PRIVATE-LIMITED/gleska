import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (target !== "worker" && target !== "employer") {
  console.error("Usage: node scripts/capacitor-sync.mjs <worker|employer>");
  process.exit(1);
}

const cliPath = fileURLToPath(new URL("../node_modules/@capacitor/cli/bin/capacitor", import.meta.url));
const result = spawnSync(process.execPath, [cliPath, "sync", "android"], {
  env: { ...process.env, CAPACITOR_APP_TARGET: target },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
