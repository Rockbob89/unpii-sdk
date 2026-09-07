import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Span, restore } from "@unpii/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restoreSummary } from "../src/messages.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_CLI = join(HERE, "..", "dist", "cli.js");
const FIXTURES_DIR = join(HERE, "..", "..", "..", "fixtures");
const SCRATCH_DIR = join(HERE, ".scratch-cli");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

const DOCS_FIXTURE = fixture("anonymize.docs.json");
const ERROR_FIXTURE = fixture("error.tier-required.json");
const FILE_FIXTURE = fixture("anonymize-file.docx.json");
const DOCS_PARSED = JSON.parse(DOCS_FIXTURE) as {
  anonymized: string;
  spans: Span[];
  uncertainSpans: Span[];
  stats: unknown;
};
const SCAN_STUB = JSON.stringify({
  spans: DOCS_PARSED.spans,
  uncertainSpans: DOCS_PARSED.uncertainSpans,
  stats: DOCS_PARSED.stats,
});

/**
 * Local `http.createServer` stub serving the real captures from the repo-root `fixtures/` — the
 * same fixtures the SDK's own tests read. There is no real `/api/v1/scan` capture yet (the route
 * doesn't exist on today's server, per `fixtures/README.md`), so `SCAN_STUB` is
 * derived from `anonymize.docs.json`'s own spans, mirroring how the SDK's own tests build that
 * endpoint's stub.
 */
function startStubServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    req.on("data", () => {
      // Body is never used — every route below responds with a canned fixture regardless of
      // what was sent, same as the SDK's own fakeFetch-based tests.
    });
    req.on("end", () => {
      res.setHeader("X-RateLimit-Limit", "100");
      res.setHeader("X-RateLimit-Remaining", "42");
      res.setHeader("X-RateLimit-Reset", String(Math.floor(Date.now() / 1000) + 30));
      const auth = req.headers.authorization ?? "";
      if (req.url === "/api/v1/anonymize") {
        if (auth.includes("error-key")) {
          res.writeHead(402, { "Content-Type": "application/json" });
          res.end(ERROR_FIXTURE);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(DOCS_FIXTURE);
        return;
      }
      if (req.url === "/api/v1/scan") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(SCAN_STUB);
        return;
      }
      if (req.url === "/api/v1/anonymize-file") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(FILE_FIXTURE);
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "not found", error: "Not Found", statusCode: 404 }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

/**
 * Spawns `dist/cli.js` ASYNCHRONOUSLY — deliberately not `spawnSync`. The stub server above runs
 * in this same process/thread; a synchronous spawn would block this thread's event loop for the
 * whole child lifetime, and the child's fetch back to that in-process server could then never be
 * serviced — a guaranteed self-deadlock (measured: a `spawnSync`-based version of this helper
 * hung for 5 minutes on the very first networked test before the process pool killed it). `spawn`
 * keeps the event loop free so the server can answer while we `await` the child's exit.
 */
function runCliBin(
  args: string[],
  opts: {
    input?: string | Buffer;
    env?: NodeJS.ProcessEnv;
    unset?: string[];
    cwd?: string;
  } = {},
): Promise<{ status: number | null; stdout: Buffer; stderr: Buffer }> {
  const base: NodeJS.ProcessEnv = { ...process.env };
  for (const key of opts.unset ?? []) delete base[key];
  const env = { ...base, ...(opts.env ?? {}) };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST_CLI, ...args], { env, cwd: opts.cwd });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      });
    });
    child.stdin.end(opts.input ?? "");
  });
}

describe("unpii CLI (spawned dist/cli.js against a local fixture server)", () => {
  let server: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    mkdirSync(SCRATCH_DIR, { recursive: true });
    server = await startStubServer();
  });

  afterAll(async () => {
    await server.close();
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
  });

  it("text via stdin -> anonymized text on stdout, exit 0", async () => {
    const result = await runCliBin([], {
      input: "Hallo Team, Anne Schmitz hat einen Termin.",
      env: { UNPII_API_KEY: "docs-key", UNPII_BASE_URL: server.url },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.toString("utf8")).toBe(DOCS_PARSED.anonymized);
    expect(result.stderr.toString("utf8")).not.toContain("Anne Schmitz");
  });

  it("--json -> stdout parses to the fixture object unchanged", async () => {
    const result = await runCliBin(["--json"], {
      input: "irrelevant, the stub always returns the same fixture",
      env: { UNPII_API_KEY: "docs-key", UNPII_BASE_URL: server.url },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.toString("utf8"))).toEqual(JSON.parse(DOCS_FIXTURE));
  });

  it("--scan -> table has categories/ids, never the original PII values", async () => {
    const result = await runCliBin(["--scan"], {
      input: "irrelevant, the stub always returns the same fixture",
      env: { UNPII_API_KEY: "docs-key", UNPII_BASE_URL: server.url },
    });
    expect(result.status).toBe(0);
    const table = result.stdout.toString("utf8");
    expect(table).toContain("PERSON");
    expect(table).toContain("PHONE");
    expect(table).toContain("ACCOUNT");
    for (const span of DOCS_PARSED.spans) {
      expect(table).not.toContain(span.original);
    }
  });

  it("a docx input (detected via magic bytes on stdin, no --out) refuses to dump binary: exit 2", async () => {
    const docxBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    const result = await runCliBin([], {
      input: docxBytes,
      env: { UNPII_API_KEY: "docs-key", UNPII_BASE_URL: server.url },
    });
    expect(result.status).toBe(2);
    expect(result.stderr.toString("utf8")).toContain("--out");
    expect(result.stdout.length).toBe(0);
  });

  it("the same docx input with --out writes exactly the decoded file bytes", async () => {
    const docxBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    const outPath = join(SCRATCH_DIR, "vertrag.anon.docx");
    const result = await runCliBin(["--out", outPath], {
      input: docxBytes,
      env: { UNPII_API_KEY: "docs-key", UNPII_BASE_URL: server.url },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const written = readFileSync(outPath);
    const expected = Buffer.from(
      (JSON.parse(FILE_FIXTURE) as { file: { contentBase64: string } }).file.contentBase64,
      "base64",
    );
    expect(written.equals(expected)).toBe(true);
  });

  it("missing key -> exit 2, message names both env vars and the account URL", async () => {
    const result = await runCliBin([], {
      input: "text",
      env: { UNPII_BASE_URL: server.url },
      unset: ["UNPII_API_KEY", "UNPII_API_KEY_FILE"],
    });
    expect(result.status).toBe(2);
    const message = result.stderr.toString("utf8");
    expect(message).toContain("UNPII_API_KEY");
    expect(message).toContain("UNPII_API_KEY_FILE");
    expect(message).toContain("https://unpii.me/de/account/api-keys");
  });

  it("a 402 from error.tier-required.json -> exit 1, one sentence, never the body or the input", async () => {
    const secretInput = "SECRET_MARKER_INPUT_cli_9f3ac21";
    const result = await runCliBin([], {
      input: secretInput,
      env: { UNPII_API_KEY: "error-key", UNPII_BASE_URL: server.url },
    });
    expect(result.status).toBe(1);
    const message = result.stderr.toString("utf8");
    expect(message.trim().length).toBeGreaterThan(0);
    expect(message).not.toContain("markerFormat not available");
    expect(message).not.toContain(secretInput);
    expect(result.stdout.length).toBe(0);
  });

  it("--scan against a server without the route (bare 404) prints one clear sentence, exit 1", async () => {
    // A dedicated server, not the shared stub above: it answers every request with Fastify's
    // own bare 404 envelope, the same shape a real deployment predating the /scan route sends —
    // the shared stub's /api/v1/scan branch always succeeds, so it can't exercise this path.
    const notFoundServer: Server = createServer((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ message: "Route not found", error: "Not Found", statusCode: 404 }),
        );
      });
    });
    const url = await new Promise<string>((resolve) => {
      notFoundServer.listen(0, "127.0.0.1", () => {
        const addr = notFoundServer.address();
        const port = typeof addr === "object" && addr !== null ? addr.port : 0;
        resolve(`http://127.0.0.1:${port}`);
      });
    });

    try {
      const result = await runCliBin(["--scan"], {
        input: "irrelevant, the server answers 404 for everything",
        env: { UNPII_API_KEY: "docs-key", UNPII_BASE_URL: url },
      });
      expect(result.status).toBe(1);
      const message = result.stderr.toString("utf8");
      expect(message).toContain("Scan");
      expect(message).not.toContain("Unbekannter Fehler");
      expect(message).not.toContain("404");
      expect(result.stdout.length).toBe(0);
    } finally {
      await new Promise<void>((res) => notFoundServer.close(() => res()));
    }
  });

  it("a .docx without --out or --json refuses before any request is sent, exit 2", async () => {
    // Counts requests instead of asserting on the shared stub's call log — the point of this
    // test is that the docx-shaped-response check now runs BEFORE the network call, so the
    // count must stay exactly 0.
    let requestCount = 0;
    const countingServer: Server = createServer((req, res) => {
      requestCount++;
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(FILE_FIXTURE);
      });
    });
    const url = await new Promise<string>((resolve) => {
      countingServer.listen(0, "127.0.0.1", () => {
        const addr = countingServer.address();
        const port = typeof addr === "object" && addr !== null ? addr.port : 0;
        resolve(`http://127.0.0.1:${port}`);
      });
    });

    try {
      const docxBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      const result = await runCliBin([], {
        input: docxBytes,
        env: { UNPII_API_KEY: "docs-key", UNPII_BASE_URL: url },
      });
      expect(result.status).toBe(2);
      expect(result.stderr.toString("utf8")).toContain("--out");
      expect(result.stdout.length).toBe(0);
      expect(requestCount).toBe(0);
    } finally {
      await new Promise<void>((res) => countingServer.close(() => res()));
    }
  });

  it("restore --from a saved --json response, answer (b) from the plan: no key, no server contacted", async () => {
    const fromPath = join(SCRATCH_DIR, "result.json");
    writeFileSync(fromPath, DOCS_FIXTURE, "utf8");
    const answer = "Bitte Person 1 vor dem Datum 1 anrufen, [PHONE 1] steht in der Mail.";

    const expected = restore(answer, DOCS_PARSED.spans);

    const result = await runCliBin(["restore", "--from", fromPath], {
      input: answer,
      // Deliberately unreachable base URL and no key at all: restore must never touch the
      // network and must never need UNPII_API_KEY.
      env: { UNPII_BASE_URL: "http://127.0.0.1:1" },
      unset: ["UNPII_API_KEY", "UNPII_API_KEY_FILE"],
    });

    expect(result.status).toBe(0);
    expect(result.stdout.toString("utf8")).toBe(expected.text);
    expect(result.stderr.toString("utf8")).toBe(restoreSummary(expected));
  });
});

describe("package.json", () => {
  it("has exactly one runtime dependency: @unpii/sdk", () => {
    const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(["@unpii/sdk"]);
    expect(pkg.dependencies["@unpii/sdk"]).toBe("workspace:*");
  });
});
