import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { invalidJsonMessage, invalidResponseMessage } from "../src/messages.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_CLI = join(HERE, "..", "dist", "cli.js");

/**
 * Guards the leak fix documented in `AGENTS.md` §6 ("Two measured gotchas"): V8's `JSON.parse`
 * quotes up to ten characters of malformed input in its own `SyntaxError` message — measured on
 * Node 24, `JSON.parse("Anne Schmitz ...")` throws
 * `Unexpected token 'A', "Anne Schmi"... is not valid JSON` — and both a `--from` file and an API
 * response body can carry PII at exactly that point. `run.ts` intercepts `SyntaxError` at two
 * call sites (`runRestore`'s `--from` parse, `runMain`'s response-body parse) and substitutes a
 * fixed sentence (`invalidJsonMessage`/`invalidResponseMessage`) instead of the caught message.
 *
 * `messages.test.ts` only exercises those two message functions as isolated strings — nothing
 * drives a broken input through a real run, so either `catch`/`if` branch in `run.ts` could be
 * deleted without turning any existing test red. These two tests close that gap.
 *
 * They spawn the BUILT `dist/cli.js`, never the TypeScript source: the leak would happen in the
 * compiled artifact users actually run, and only a real subprocess proves stdout/stderr never
 * carried the fragment — the same reasoning as `no-write.test.ts`'s subprocess layer proving its
 * claim from outside the process, rather than by inspecting in-process call arguments. `spawn`
 * (not `spawnSync`) is required for test 2, which runs a stub HTTP server in this same
 * process/thread — see `cli.test.ts`'s `runCliBin` doc comment for the measured self-deadlock a
 * synchronous spawn causes there.
 */

const LEAK_TEXT = "Anne Schmitz wohnt in Musterstadt, Telefon 0151 23456789.";
const LEAK_TOKENS = ["Anne Schmi", "Anne", "Schmitz", "Musterstadt", "0151", LEAK_TEXT];

/** Deterministic child environment: `resolveLang` (messages.ts) reads `LANG`/`LC_ALL`, so the
 * `invalidJsonMessage()`/`invalidResponseMessage()` assertions below must pin the language
 * explicitly — otherwise they'd depend on whatever locale the CI runner or dev machine happens to
 * carry. */
function childEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env, LANG: "C" };
  for (const key of ["LC_ALL"]) delete base[key];
  return { ...base, ...extra };
}

function spawnCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  input: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST_CLI, ...args], { env });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
    // Both scenarios below fail before the CLI ever reads stdin, so the write side can error
    // once the child has already exited — an unhandled 'error' event there would otherwise crash
    // this test process (measured flakiness pattern; mirrors cli.test.ts's runCliBin).
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function assertNoLeak(output: string): void {
  for (const token of LEAK_TOKENS) {
    expect(output).not.toContain(token);
  }
}

describe("no-leak invariant — a JSON.parse SyntaxError never forwards its quoted fragment", () => {
  it("a broken --from file that starts with PII text: exit 1, no leak, fixed sentence present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unpii-cli-no-leak-"));
    const filePath = join(dir, "broken.json");
    try {
      writeFileSync(filePath, LEAK_TEXT, "utf8");

      const result = await spawnCli(["restore", "--from", filePath], childEnv({}), "");

      expect(result.status).toBe(1);
      assertNoLeak(result.stdout);
      assertNoLeak(result.stderr);
      // Proves the run actually reached the protected branch — without this, the test would
      // also pass if the CLI failed one line earlier for an unrelated reason.
      expect(result.stderr).toContain(invalidJsonMessage("en"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a 200 response whose body is PII text, not JSON: exit 1, no leak, fixed sentence present", async () => {
    const server: Server = createServer((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(LEAK_TEXT);
      });
    });
    const url = await new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr !== null ? addr.port : 0;
        resolve(`http://127.0.0.1:${port}`);
      });
    });

    try {
      const result = await spawnCli(
        [],
        childEnv({ UNPII_API_KEY: "docs-key", UNPII_BASE_URL: url }),
        "irrelevant, the stub always answers with the same non-JSON body",
      );

      expect(result.status).toBe(1);
      assertNoLeak(result.stdout);
      assertNoLeak(result.stderr);
      expect(result.stderr).toContain(invalidResponseMessage("en"));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
