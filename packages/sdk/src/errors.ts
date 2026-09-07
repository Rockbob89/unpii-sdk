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

  constructor(status: number, code: string | undefined, requestId: string | undefined) {
    const safeCode = code !== undefined && CODE_PATTERN.test(code) ? code : undefined;
    const message =
      safeCode !== undefined ? `unpii: ${safeCode} (HTTP ${status})` : `unpii: HTTP ${status}`;
    super(message);
    this.name = "UnpiiError";
    this.status = status;
    this.code = safeCode;
    this.requestId = requestId;
  }
}
