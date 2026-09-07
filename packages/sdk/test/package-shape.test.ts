import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(HERE, "..");
const DIST_DIR = join(PKG_DIR, "dist");
const PKG_PATH = join(PKG_DIR, "package.json");

interface PackageJson {
  type?: string;
  main?: string;
  types?: string;
  exports?: unknown;
  files?: string[];
  publishConfig?: { access?: string };
  engines?: { node?: string };
  dependencies?: Record<string, string>;
}

function readPackageJson(): PackageJson {
  // Parsed from the file on disk, deliberately not `import`-ed: an import would go through
  // Node's module resolution / a bundler and could be satisfied from a cached or transformed
  // copy. Reading the raw bytes and parsing them is what actually asserts on the file that ships.
  return JSON.parse(readFileSync(PKG_PATH, "utf8")) as PackageJson;
}

/**
 * The README and a comment in src/client.ts both promise "a test keeps `dependencies` empty".
 * That was false until this file existed — see AGENTS.md §2 for the promise this test enforces.
 * Mirrors the shape of the "package.json" describe block in packages/cli/test/cli.test.ts
 * (which checks the CLI's own `dependencies`), so the two packages' zero/one-dependency claims
 * are guarded the same way.
 */
describe("package.json", () => {
  it("has no runtime dependencies — the zero-dependency promise in the README", () => {
    const pkg = readPackageJson();
    // `dependencies` may be entirely absent, or present and empty — both satisfy the promise.
    // What must never happen is a non-empty `dependencies` object.
    if (pkg.dependencies !== undefined) {
      expect(Object.keys(pkg.dependencies)).toEqual([]);
    }
  });

  it('files is exactly ["dist", "README.md"]', () => {
    const pkg = readPackageJson();
    expect(pkg.files).toEqual(["dist", "README.md"]);
  });

  it('type is "module" (ESM only, JS charter)', () => {
    const pkg = readPackageJson();
    expect(pkg.type).toBe("module");
  });

  it("main, types and exports point at the built dist/ entry point", () => {
    const pkg = readPackageJson();
    expect(pkg.main).toBe("./dist/index.js");
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    });
  });

  it('publishConfig.access is "public" (scoped package, must not default to restricted)', () => {
    const pkg = readPackageJson();
    expect(pkg.publishConfig?.access).toBe("public");
  });

  it("engines.node matches the CLI's floor", () => {
    const pkg = readPackageJson();
    expect(pkg.engines?.node).toBe(">=22");
  });
});

/**
 * `files` above is a promise, not an enforcement — nothing stops it drifting to also include
 * `test/`, `test-cases/`, `fixtures/` or `scripts/`. `npm pack --dry-run` is the only thing that
 * reports what actually ships, so this asks npm itself rather than re-deriving the rule from
 * package.json a second time.
 *
 * `dist/` is built by this package's own vitest `globalSetup` (`test/build-setup.ts`, wired in
 * `vitest.config.ts`) before ANY test file in this package runs — including this one — so
 * `existsSync(DIST_DIR)` below is a defensive assertion, not the thing making the build happen.
 * It exists so a future change that removes that globalSetup fails loudly here instead of this
 * test silently having nothing under dist/ to inspect.
 */
describe("npm pack contents", () => {
  it("dist/ exists (built by globalSetup) before the pack check runs", () => {
    if (!existsSync(DIST_DIR)) {
      throw new Error(
        `${DIST_DIR} is missing. \`npm pack --dry-run\` needs the built package; run \`pnpm --filter @unpii/sdk build\` (or check that this package's vitest globalSetup still runs).`,
      );
    }
  });

  it("ships dist/ and README.md, never test/, fixtures/, test-cases/ or scripts/", async () => {
    const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
      cwd: PKG_DIR,
    });
    const [result] = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
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
