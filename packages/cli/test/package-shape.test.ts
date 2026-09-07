import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(HERE, "..");
const DIST_DIR = join(PKG_DIR, "dist");

interface NpmPackResult {
  files: Array<{ path: string }>;
}

/**
 * `files: ["dist", "README.md"]` in package.json is a promise, not an enforcement — nothing
 * stops it drifting to also include `test/` or a stray `.env`. `npm pack --dry-run` is the only
 * thing that reports what actually ships, so this asks npm itself rather than re-deriving the
 * rule from package.json a second time.
 *
 * `dist/` is built by this package's own vitest `globalSetup` (`test/build-setup.ts`, wired in
 * `vitest.config.ts`) before ANY test file in this package runs — including this one — so
 * `existsSync(DIST_DIR)` below is a defensive assertion, not the thing making the build happen.
 * It exists so a future change that removes that globalSetup fails loudly here instead of this
 * test silently having nothing to inspect.
 */
describe("npm pack contents", () => {
  it("dist/ exists (built by globalSetup) before the pack check runs", () => {
    if (!existsSync(DIST_DIR)) {
      throw new Error(
        `${DIST_DIR} is missing. \`npm pack --dry-run\` needs the built package; run \`pnpm --filter unpii build\` (or check that this package's vitest globalSetup still runs).`,
      );
    }
  });

  it("ships dist/ and README.md, never test/, fixtures/, test-cases/ or scripts/", async () => {
    const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
      cwd: PKG_DIR,
    });
    const [result] = JSON.parse(stdout) as NpmPackResult[];
    const paths = (result?.files ?? []).map((f) => f.path);

    expect(paths.some((p) => p.startsWith("dist/"))).toBe(true);
    expect(paths).toContain("README.md");

    for (const forbidden of ["test/", "fixtures/", "test-cases/", "scripts/"]) {
      expect(
        paths.some((p) => p.startsWith(forbidden)),
        `no packed path should start with "${forbidden}", got: ${JSON.stringify(paths)}`,
      ).toBe(false);
    }
  });
});
