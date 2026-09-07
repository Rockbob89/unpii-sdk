import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sdkDir = resolve(here, "..");

/**
 * Vitest globalSetup: builds this package before any test runs, so `dist/` exists for
 * `test/package-shape.test.ts`'s `npm pack --dry-run` check. Mirrors
 * `packages/cli/test/build-setup.ts` (which builds this same package, plus its own, for the
 * identical reason).
 *
 * Runs once per `vitest run`, not per test file. The rest of this package's tests
 * (`client.test.ts`, `restore.test.ts`, `gen-types.test.ts`) import from `../src/*.js` directly
 * and don't need `dist/` at all — this build exists solely so the pack check never silently
 * passes because there was nothing under `dist/` to inspect.
 */
export default function setup(): void {
  execFileSync("pnpm", ["--dir", sdkDir, "run", "build"], { stdio: "inherit" });
}
