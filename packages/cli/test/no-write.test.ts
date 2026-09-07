import { spawn } from "node:child_process";
import * as fsSync from "node:fs";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_CLI = join(HERE, "..", "dist", "cli.js");
const FIXTURES_DIR = join(HERE, "..", "..", "..", "fixtures");
const DOCS_FIXTURE = fsSync.readFileSync(join(FIXTURES_DIR, "anonymize.docs.json"), "utf8");

/**
 * `node:fs/promises`'/`node:fs`'s ESM module namespace objects are non-configurable — a plain
 * `vi.spyOn(fsp, "writeFile")` throws "Cannot redefine property" against them (measured
 * 2026-09-07). `vi.mock` with an `importOriginal` passthrough is the correct tool: it swaps the
 * whole module binding at the loader level (reaching `run.ts`'s own `import { writeFile } from
 * "node:fs/promises"` transitively) instead of trying to mutate a frozen object in place, and
 * still delegates to the real implementation so reads keep working.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

// Imported AFTER the vi.mock calls above (vitest hoists vi.mock to the top of the file
// regardless of source order, so this ordering is for human readability, not correctness) —
// these are the run-path's own dependencies, now carrying the mocked fs functions.
const { parseArgs } = await import("../src/args.js");
const { runCli } = await import("../src/run.js");
const { writeFile } = await import("node:fs/promises");
const { writeFileSync } = await import("node:fs");

/** A drained, discard-everything writable — enough to let `write()` in run.ts resolve its
 * callback without a real destination. */
function sink(): NodeJS.WritableStream {
  const stream = new PassThrough();
  stream.resume();
  return stream;
}

/**
 * Layer (a): in-process. `run.ts` imports `writeFile` from `node:fs/promises` and (indirectly,
 * for reading its own package.json) `readFileSync` from `node:fs` — it never imports
 * `writeFileSync` at all, so spying on both and asserting neither fires is a real assertion, not
 * a tautology: if a future change introduced a stray `writeFileSync` call anywhere on the
 * no-`--out` path, this goes red.
 */
describe("no-write invariant — in process (mocked fs)", () => {
  afterEach(() => {
    vi.mocked(writeFile).mockClear();
    vi.mocked(writeFileSync).mockClear();
  });

  it("the main text path without --out never calls writeFile or writeFileSync", async () => {
    const fakeFetch = (async () =>
      new Response(DOCS_FIXTURE, {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const args = parseArgs([]);
    const code = await runCli(
      args,
      { UNPII_API_KEY: "docs-key" },
      {
        stdin: Readable.from(["Hallo Anne Schmitz"]),
        stdout: sink(),
        stderr: sink(),
        fetch: fakeFetch,
      },
    );

    expect(code).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("restore without --out never calls writeFile/writeFileSync, and never calls fetch at all", async () => {
    const fetchSpy = vi.fn();

    // Reads a real, pre-existing, read-only fixture as --from — no file is created for this
    // test, so it can't itself be mistaken for a write the CLI made.
    const args = parseArgs(["restore", "--from", join(FIXTURES_DIR, "anonymize.docs.json")]);
    const code = await runCli(
      args,
      {},
      {
        stdin: Readable.from([
          "Bitte Person 1 vor dem Datum 1 anrufen, [PHONE 1] steht in der Mail.",
        ]),
        stdout: sink(),
        stderr: sink(),
        fetch: fetchSpy as unknown as typeof fetch,
      },
    );

    expect(code).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

/**
 * Layer (b): subprocess, real OS-level check. Layer (a) proves the in-process code path never
 * calls the write functions it imports; this proves the same claim from outside the process, on
 * a fresh, empty `cwd`, against the REAL filesystem — no mocking, so it also catches a stray
 * write through a dependency this package doesn't import directly (a future `@unpii/sdk` bump
 * that starts caching to disk, for instance).
 *
 * Uses `spawn`, not `spawnSync` — the stub server below runs in this same process/thread, and a
 * synchronous spawn would freeze this thread's event loop for the child's whole lifetime,
 * preventing the server from ever answering the child's request (measured: a `spawnSync` version
 * of this test hung for 5 minutes before being killed). `spawn` keeps the loop free.
 */
describe("no-write invariant — subprocess (real filesystem, no mocks)", () => {
  it("a full anonymize call without --out leaves the filesystem untouched", async () => {
    const server: Server = createServer((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(DOCS_FIXTURE);
      });
    });
    const url = await new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr !== null ? addr.port : 0;
        resolve(`http://127.0.0.1:${port}`);
      });
    });

    const tmpRoot = tmpdir();
    const beforeTop = new Set(fsSync.readdirSync(tmpRoot));
    const freshDir = fsSync.mkdtempSync(join(tmpRoot, "unpii-cli-nowrite-"));

    try {
      const status = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, [DIST_CLI], {
          cwd: freshDir,
          env: { ...process.env, UNPII_API_KEY: "docs-key", UNPII_BASE_URL: url },
        });
        child.on("error", reject);
        child.on("close", resolve);
        child.stdin.end("Hallo Anne Schmitz");
      });

      expect(status).toBe(0);
      // The directory the CLI ran in stayed empty — no temp file, no log file, no cache.
      expect(fsSync.readdirSync(freshDir)).toEqual([]);
      // Nothing NEW appeared anywhere else under the system temp root either. `freshDir` itself
      // is excluded — it's test scaffolding created before the "before" snapshot, not something
      // the CLI wrote.
      const freshDirName = freshDir.slice(tmpRoot.length + 1).split(/[/\\]/)[0];
      const newTopEntries = fsSync
        .readdirSync(tmpRoot)
        .filter((name) => !beforeTop.has(name) && name !== freshDirName);
      expect(newTopEntries).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fsSync.rmSync(freshDir, { recursive: true, force: true });
    }
  });
});
