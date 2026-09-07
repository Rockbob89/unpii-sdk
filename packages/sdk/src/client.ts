import { UnpiiError } from "./errors.js";
import type {
  AnonymizeFileResponse,
  AnonymizeFileTextResponse,
  AnonymizeResponse,
} from "./types.generated.js";
import type {
  AnonymizeFileOptions,
  AnonymizeOptions,
  LimitsResponse,
  ScanResponse,
  UnpiiOptions,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.unpii.me";

/**
 * Reads a possibly-error response body as JSON without ever throwing. An error body can be a
 * normal `{ error: { code, message } }` envelope, but it can also be something this SDK does
 * not control at all — e.g. Fastify's own 404 for a route that doesn't exist yet
 * (`{ message, error: "Not Found", statusCode }`, `error` is a STRING there, not an object), or
 * no body at all. All of those are legitimate non-2xx responses, not bugs in this function, so a
 * parse failure here is deliberately swallowed into `undefined` rather than re-thrown — the
 * caller (errorFromResponse) already treats "no usable code" as a valid outcome.
 */
async function safeReadJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * Pulls a candidate error code out of a parsed body, tolerating every shape a server (ours or
 * not) might send: `body` itself may not be an object, `body.error` may be missing or may be a
 * plain string (Fastify's default 404/405 envelope) instead of `{ code, message, ... }`, and
 * `body.error.code` may be missing or non-string. Every one of those returns `undefined` here;
 * `UnpiiError`'s own constructor is what actually validates the shape of a real code.
 */
function extractErrorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const bodyError = (body as { error?: unknown }).error;
  if (typeof bodyError !== "object" || bodyError === null) return undefined;
  const code = (bodyError as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Thin HTTP client for the unpii.me API. `new Unpii({ apiKey })` is the whole setup — no zod,
 * no other runtime dependency (Charter: `dependencies: {}` in package.json).
 *
 * Responses are returned as `await res.json()` cast to the declared type, never validated
 * against a schema at runtime: this package carries no zod dependency at runtime (only as a
 * devDependency, for the type generator), and a server that adds a field later must not break
 * an SDK version that predates it — that's exactly what "returns parsed JSON" buys.
 */
export class Unpii {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: UnpiiOptions) {
    if (opts.apiKey.trim().length === 0) {
      throw new UnpiiError(0, "missing_api_key", undefined);
    }
    this.apiKey = opts.apiKey;
    // Trailing slash(es) stripped so callers can pass either "https://host" or "https://host/".
    // No environment variable is ever read here — UNPII_BASE_URL is a CLI-level concern
    // (packages/cli), not an SDK one; a test asserts the env var has zero effect on the SDK.
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  private async errorFromResponse(res: Response): Promise<UnpiiError> {
    const body = await safeReadJson(res);
    const code = extractErrorCode(body);
    const requestId = res.headers.get("x-request-id") ?? undefined;
    return new UnpiiError(res.status, code, requestId);
  }

  /** Shared request path: adds auth, checks `res.ok`, throws `UnpiiError` otherwise, and
   * otherwise returns the parsed JSON body cast to `T` — see the class doc comment for why
   * there is no runtime validation step here. */
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${this.apiKey}`,
    };
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      throw await this.errorFromResponse(res);
    }
    return (await res.json()) as T;
  }

  async anonymize(text: string, opts?: AnonymizeOptions): Promise<AnonymizeResponse> {
    const body: Record<string, unknown> = { text };
    if (opts?.markerFormat !== undefined) body.markerFormat = opts.markerFormat;
    if (opts?.ambiguous !== undefined) body.ambiguous = opts.ambiguous;
    if (opts?.keep !== undefined) body.keep = opts.keep;
    if (opts?.structure !== undefined) body.structure = opts.structure;
    return this.request<AnonymizeResponse>("/api/v1/anonymize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async scan(text: string): Promise<ScanResponse> {
    return this.request<ScanResponse>("/api/v1/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }

  /**
   * Multipart upload for `POST /api/v1/anonymize-file`. `bytes` is either a .docx or a .pdf —
   * the server sniffs the format from the bytes, this function doesn't need to know which.
   *
   * CRITICAL and load-bearing: `markerFormat`, `redactUncertain` and `outputFormat` are
   * appended to the form BEFORE the `file` part. The server's multipart parser does not
   * reliably read fields that follow the file part — the same law is written, and obeyed, in
   * `apps/web/src/lib/file-upload.ts`. Do not reorder this.
   *
   * Content-Type is intentionally NOT set by hand: `fetch` fills in the multipart boundary
   * itself, and setting it manually would break parsing.
   */
  async anonymizeFile(
    bytes: Uint8Array,
    opts: AnonymizeFileOptions,
  ): Promise<AnonymizeFileResponse | AnonymizeFileTextResponse> {
    const form = new FormData();
    if (opts.markerFormat !== undefined) form.append("markerFormat", opts.markerFormat); // BEFORE file — law
    if (opts.redactUncertain !== undefined) {
      form.append("redactUncertain", String(opts.redactUncertain)); // BEFORE file — law
    }
    if (opts.outputFormat !== undefined) form.append("outputFormat", opts.outputFormat); // BEFORE file — law
    // `new Uint8Array(bytes)` (the ArrayLike overload, not the ArrayBufferLike one) always
    // allocates a fresh plain-ArrayBuffer-backed copy — needed only to satisfy TS 5.7+'s
    // BlobPart typing, which excludes SharedArrayBuffer-backed views; `bytes` itself is typed
    // as the more permissive `Uint8Array<ArrayBufferLike>`.
    form.append("file", new Blob([new Uint8Array(bytes)]), opts.filename);

    return this.request<AnonymizeFileResponse | AnonymizeFileTextResponse>(
      "/api/v1/anonymize-file",
      { method: "POST", body: form },
    );
  }

  async limits(): Promise<LimitsResponse> {
    return this.request<LimitsResponse>("/api/v1/limits", { method: "GET" });
  }
}
