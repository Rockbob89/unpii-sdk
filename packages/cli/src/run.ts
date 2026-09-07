import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AnonymizeFileResponse,
  type AnonymizeFileTextResponse,
  type ScanResponse,
  type Span,
  Unpii,
  UnpiiError,
  restore,
} from "@unpii/sdk";
import type { ParsedArgs, RestoreArgs, RunArgs } from "./args.js";
import {
  answerReadFailedMessage,
  apiErrorMessage,
  fromReadFailedMessage,
  genericErrorMessage,
  helpText,
  inputReadFailedMessage,
  invalidJsonMessage,
  invalidResponseMessage,
  missingSpansArrayMessage,
  noApiKeyMessage,
  outRequiredForDocumentMessage,
  rateLimitSentence,
  restoreNeedsFromMessage,
  restoreSummary,
  scanNotAvailableMessage,
} from "./messages.js";

/**
 * The streams and (test-only) fetch override `runCli` operates over. In production `cli.ts`
 * passes the real `process.std{in,out,err}` and no `fetch` (falls back to `globalThis.fetch`).
 * Tests pass in-memory streams and a canned `fetch` — the same pattern the SDK's own
 * `client.test.ts` uses (`fakeFetch`), just threaded one level up.
 */
export interface RunIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  fetch?: typeof globalThis.fetch;
}

type DetectedFormat = "docx" | "pdf" | "text";

/**
 * Detects the input format from BOTH the extension and the first bytes — the extension is a
 * claim, the bytes are the evidence. Mirrors the server's own sniff exactly
 * (`apps/api/src/routes/anonymize-file.ts`'s `sniffFormat`: "PK" for docx, "%PDF-" for pdf).
 * When the two disagree, the bytes win.
 */
export function detectFormat(bytes: Buffer, path: string | undefined): DetectedFormat {
  const byBytes = sniffBytes(bytes);
  if (byBytes) return byBytes;
  const byExtension = path !== undefined ? extensionHint(path) : undefined;
  return byExtension ?? "text";
}

function sniffBytes(bytes: Buffer): "docx" | "pdf" | undefined {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return "docx"; // "PK"
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  return undefined;
}

function extensionHint(path: string): "docx" | "pdf" | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  return undefined;
}

async function readStdin(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

/** Writes and waits for the write to actually complete before returning — `cli.ts` calls
 * `process.exit` right after `runCli` resolves (needed because a leftover keep-alive socket
 * from `fetch` can otherwise keep the process alive indefinitely), so every payload that matters
 * must be flushed before that point rather than left to a `process.exit`-truncated buffer. */
function write(stream: NodeJS.WritableStream, data: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(data, (err) => (err ? reject(err) : resolve()));
  });
}

async function resolveApiKey(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const direct = env.UNPII_API_KEY;
  if (direct !== undefined && direct.length > 0) return direct;
  const filePath = env.UNPII_API_KEY_FILE;
  if (filePath === undefined) return undefined;
  try {
    const raw = await readFile(filePath, "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function readOwnVersion(): string {
  // "../package.json" from both src/run.ts and dist/run.js lands at packages/cli/package.json —
  // src and dist sit at the same depth under the package root.
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const raw = readFileSync(pkgPath, "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}

function wrapFetch(
  base: typeof globalThis.fetch,
  onHeaders: (headers: Headers) => void,
): typeof globalThis.fetch {
  return (async (input, init) => {
    const res = await base(input, init);
    onHeaders(res.headers);
    return res;
  }) as typeof globalThis.fetch;
}

async function emitRateLimitSentence(
  headers: Headers | undefined,
  stderr: NodeJS.WritableStream,
): Promise<void> {
  if (headers === undefined) return;
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining === null || reset === null) return;
  const remainingNum = Number(remaining);
  const resetNum = Number(reset);
  if (!Number.isFinite(remainingNum) || !Number.isFinite(resetNum)) return;
  const limitHeader = headers.get("x-ratelimit-limit");
  const limitNum = limitHeader !== null ? Number(limitHeader) : undefined;
  const resetInSeconds = Math.max(0, resetNum - Math.floor(Date.now() / 1000));
  await write(
    stderr,
    rateLimitSentence(
      remainingNum,
      Number.isFinite(limitNum) ? limitNum : undefined,
      resetInSeconds,
    ),
  );
}

function isFileResponse(
  res: AnonymizeFileResponse | AnonymizeFileTextResponse,
): res is AnonymizeFileResponse {
  return "file" in res;
}

interface SpanTableRow {
  category: string;
  id: number;
  start: number;
  end: number;
  score: number | undefined;
  uncertain: boolean;
}

/** Renders a plain-text table of spans WITHOUT the `original` field — that is the entire point
 * of `--scan`: show what would be found without reprinting the PII itself. Both `spans` and
 * `uncertainSpans` are included (a low-confidence span is signal, never silently dropped —
 * Charter §4). */
export function renderScanTable(res: {
  spans: Span[];
  uncertainSpans: Span[];
}): string {
  const rows: SpanTableRow[] = [
    ...res.spans.map((s) => toRow(s, false)),
    ...res.uncertainSpans.map((s) => toRow(s, true)),
  ];
  const headers = ["CATEGORY", "ID", "START", "END", "SCORE", "STATUS"];
  const cells = rows.map((r) => [
    r.category,
    String(r.id),
    String(r.start),
    String(r.end),
    r.score !== undefined ? r.score.toFixed(2) : "-",
    r.uncertain ? "unsicher" : "sicher",
  ]);
  return `${tabulate(headers, cells)}\n`;
}

function toRow(span: Span, uncertain: boolean): SpanTableRow {
  return {
    category: span.category,
    id: span.id,
    start: span.start,
    end: span.end,
    score: span.score,
    uncertain,
  };
}

function tabulate(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]): string =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? c.length))
      .join("  ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

async function runRestore(args: RestoreArgs, io: RunIO): Promise<number> {
  // No API key, no network — the whole point of `restore` is that it's a pure local
  // re-substitution over a response the caller already fetched (Charter/plan: "Kein Request beim
  // Zurückübersetzen, unter keiner Bedingung").
  const from = args.from;
  if (from === undefined) {
    // Guarded by args.ts already (ArgsError when !help && from === undefined); reachable only if
    // that invariant is ever broken, so this is a defensive fallback, not a normal path.
    await write(io.stderr, `${restoreNeedsFromMessage()}\n`);
    return 2;
  }

  let raw: string;
  try {
    raw = await readFile(from, "utf8");
  } catch (err) {
    // An fs error here describes the path, never the file's content — safe to forward verbatim.
    const message = err instanceof Error ? err.message : String(err);
    await write(io.stderr, fromReadFailedMessage(message));
    return 1;
  }

  let spans: Span[];
  try {
    const parsed: unknown = JSON.parse(raw);
    const maybeSpans = (parsed as { spans?: unknown }).spans;
    if (!Array.isArray(maybeSpans)) {
      await write(io.stderr, fromReadFailedMessage(missingSpansArrayMessage()));
      return 1;
    }
    spans = maybeSpans as Span[];
  } catch {
    // JSON.parse's own SyntaxError can quote a fragment of the malformed text in its message —
    // see invalidJsonMessage's doc comment in messages.ts. This file's spans carry their
    // `original` PII values, so that fragment is never forwarded; a static sentence goes out
    // instead.
    await write(io.stderr, fromReadFailedMessage(invalidJsonMessage()));
    return 1;
  }

  let answer: string;
  try {
    answer =
      args.path !== undefined
        ? await readFile(args.path, "utf8")
        : (await readStdin(io.stdin)).toString("utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await write(io.stderr, answerReadFailedMessage(message));
    return 1;
  }

  const result = restore(answer, spans);

  if (args.out !== undefined) {
    await writeFile(args.out, result.text, "utf8");
  } else {
    await write(io.stdout, result.text);
  }
  await write(io.stderr, restoreSummary(result));
  return 0;
}

async function runMain(args: RunArgs, env: NodeJS.ProcessEnv, io: RunIO): Promise<number> {
  const apiKey = await resolveApiKey(env);
  if (apiKey === undefined) {
    await write(io.stderr, noApiKeyMessage());
    return 2;
  }

  let bytes: Buffer;
  try {
    bytes = args.path !== undefined ? await readFile(args.path) : await readStdin(io.stdin);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await write(io.stderr, inputReadFailedMessage(message));
    return 1;
  }

  const format = detectFormat(bytes, args.path);

  // A .docx input always comes back as a full rebuilt document (grounding:
  // apps/api/src/routes/anonymize-file.ts — .docx has no text-output mode, unlike PDF, which
  // an API-key caller gets as plain text by default). Without --out there is nowhere to put
  // that document, and without --json there is no envelope to inspect instead, so the call
  // could never have succeeded — the format is already known from the magic bytes, so this
  // fails before any request is sent. Mirrors the server's own gate order (same file, header
  // comment): validation fires before the rate-limit check so a request that was always going
  // to be rejected never burns the caller's daily budget.
  if (format === "docx" && !args.scan && !args.json && args.out === undefined) {
    await write(io.stderr, outRequiredForDocumentMessage());
    return 2;
  }

  const isTextScan = format === "text" && args.scan;

  let lastHeaders: Headers | undefined;
  const fetchImpl = wrapFetch(io.fetch ?? globalThis.fetch, (h) => {
    lastHeaders = h;
  });
  const client = new Unpii({
    apiKey,
    baseUrl: env.UNPII_BASE_URL,
    fetch: fetchImpl,
  });

  try {
    let payload: string | Buffer;

    if (format === "text") {
      const text = bytes.toString("utf8");
      if (args.scan) {
        const res: ScanResponse = await client.scan(text);
        payload = args.json ? JSON.stringify(res, null, 2) : renderScanTable(res);
      } else {
        const res = await client.anonymize(text, {
          ...(args.marker !== undefined ? { markerFormat: args.marker } : {}),
          ...(args.keep !== undefined ? { keep: args.keep } : {}),
        });
        payload = args.json ? JSON.stringify(res, null, 2) : res.anonymized;
      }
    } else {
      const filename = args.path !== undefined ? basename(args.path) : `input.${format}`;
      const res = await client.anonymizeFile(bytes, {
        filename,
        ...(args.marker !== undefined ? { markerFormat: args.marker } : {}),
      });
      if (args.scan) {
        payload = args.json ? JSON.stringify(res, null, 2) : renderScanTable(res);
      } else if (args.json) {
        payload = JSON.stringify(res, null, 2);
      } else if (isFileResponse(res)) {
        if (args.out === undefined) {
          await emitRateLimitSentence(lastHeaders, io.stderr);
          await write(io.stderr, outRequiredForDocumentMessage());
          return 2;
        }
        payload = Buffer.from(res.file.contentBase64, "base64");
      } else {
        payload = res.text;
      }
    }

    await emitRateLimitSentence(lastHeaders, io.stderr);

    if (args.out !== undefined) {
      await writeFile(args.out, payload);
    } else {
      await write(io.stdout, payload);
    }
    return 0;
  } catch (err) {
    await emitRateLimitSentence(lastHeaders, io.stderr);
    if (err instanceof UnpiiError) {
      if (isTextScan && err.status === 404) {
        await write(io.stderr, scanNotAvailableMessage());
        return 1;
      }
      await write(io.stderr, apiErrorMessage(err));
      return 1;
    }
    if (err instanceof SyntaxError) {
      // res.json() (the SDK's undici-based fetch) throws SyntaxError when the response body
      // isn't valid JSON, and that error's own message can quote a fragment of the body
      // (measured against a real undici fetch) — a --json response's spans carry their
      // `original` PII values, so it is never forwarded. See invalidResponseMessage's doc
      // comment in messages.ts.
      await write(io.stderr, invalidResponseMessage());
      return 1;
    }
    const message = err instanceof Error ? err.message : String(err);
    await write(io.stderr, genericErrorMessage(message));
    return 1;
  }
}

/** Runs the CLI end to end for one invocation and returns the exit code — never calls
 * `process.exit` itself (see `cli.ts`). Writes ONLY through `io.stdout`/`io.stderr` and, when
 * `--out` was given, exactly one file at that path; no temp file, no log file, no cache. */
export async function runCli(args: ParsedArgs, env: NodeJS.ProcessEnv, io: RunIO): Promise<number> {
  if (args.help) {
    await write(io.stdout, helpText());
    return 0;
  }
  if (args.version) {
    await write(io.stdout, `${readOwnVersion()}\n`);
    return 0;
  }
  return args.command === "restore" ? runRestore(args, io) : runMain(args, env, io);
}
