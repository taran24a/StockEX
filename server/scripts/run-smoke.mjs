import process from "node:process";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";

if (process.env.SMOKE_DATABASE_URL === undefined) {
  process.stderr.write("Set SMOKE_DATABASE_URL to the dedicated tradewise_test database before running the smoke test.\n");
  process.exit(1);
}

const vitestCli = fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(
  process.execPath,
  [vitestCli, "run", "src/smoke.e2e.test.ts"],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: process.env,
    stdio: "inherit"
  }
);

if (result.error !== undefined) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
