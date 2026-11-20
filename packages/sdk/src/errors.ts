/**
 * Loose bound on a wire error `code`: lowercase snake_case, capped length. Anything outside
 * this shape — a hostile string, an unexpected type, or nothing at all — becomes `undefined`
 * rather than being trusted onto `.code` or into the error message.
 */
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Thrown by `Unpii` for any non-2xx response, and for a missing API key at construction time.
 *
 * The message is built ONLY from `code` and `status` — e.g. `unpii: tier_required (HTTP 402)`
 * or `unpii: HTTP 500` when there is no usable code. It NEVER contains the response body or the
 * caller's input text, so a caught `UnpiiError` can be logged or shown to a user without risking
 * a leak of whatever text was in the request or response (Charter §1: request text is not
 * something this SDK is allowed to echo back into an error).
 */
export class UnpiiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  /**
   * Seconds from a `Retry-After` response header (503 `server_busy`, 429 `custom_rules_busy`,
   * ...), or `undefined` when the header was absent or not a plain non-negative integer. The
   * HTTP-date form is deliberately not parsed: the server only ever sends seconds.
   */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    code: string | undefined,
    requestId: string | undefined,
    retryAfterSeconds?: number,
  ) {
    const safeCode = code !== undefined && CODE_PATTERN.test(code) ? code : undefined;
    const message =
      safeCode !== undefined ? `unpii: ${safeCode} (HTTP ${status})` : `unpii: HTTP ${status}`;
    super(message);
    this.name = "UnpiiError";
    this.status = status;
    this.code = safeCode;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Thrown for 503 `server_busy`: the service is full right now and refused the request before
 * doing any work. It is "try again later", not a fault in the request and not an outage -
 * deliberately a different type from `inference_unavailable` (model unreachable), which stays a
 * plain `UnpiiError`. The SDK never retries by itself: whether and when to try again is the
 * caller's decision, `retryAfterSeconds` is the server's hint for it.
 */
export class UnpiiBusyError extends UnpiiError {
  constructor(status: number, requestId: string | undefined, retryAfterSeconds?: number) {
    super(status, "server_busy", requestId, retryAfterSeconds);
    this.name = "UnpiiBusyError";
  }
}

/** Parses a `Retry-After` value: digits only, at most 6 of them (about 11 days); anything else
 * is `undefined`. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d{1,6}$/.test(value.trim())) return undefined;
  return Number(value.trim());
}
