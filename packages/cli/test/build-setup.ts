import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(here, "..");
const sdkDir = resolve(cliDir, "../sdk");

/**
 * Vitest globalSetup: builds `@unpii/sdk` and then this package before any test in this package
 * runs. `cli.test.ts` and `no-write.test.ts`'s subprocess half spawn the BUILT `dist/cli.js` —
 * that's the only way to exercise the real `node_modules` resolution of `@unpii/sdk` a published
 * consumer would hit (`tsconfig.build.json` has no `paths` override, unlike `tsconfig.json`).
 *
 * Runs once per `vitest run`, not per test file — building twice per file would be wasteful and
 * these builds are read-only with respect to test state (no fixtures, no mutation).
 */
export default function setup(): void {
  execFileSync("pnpm", ["--dir", sdkDir, "run", "build"], { stdio: "inherit" });
  execFileSync("pnpm", ["--dir", cliDir, "run", "build"], { stdio: "inherit" });
}
