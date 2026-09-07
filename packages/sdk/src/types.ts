import type { AmbiguousMode, AnonymizeStats, MarkerFormat, Span } from "./types.generated.js";

/**
 * Response of `POST /api/v1/scan`. That route does not exist yet on the server this SDK talks
 * to — `contract/openapi.json` carries no `/api/v1/scan` path, so this type cannot be derived
 * and stays hand-typed ahead of the server shipping it (see `contract/README.md`). Once the
 * route exists and appears in the contract, this belongs in `types.generated.ts` like its
 * siblings, and this hand-written version should be deleted. Extra fields the server later adds
 * (e.g. `receipt`) are tolerated because the SDK never validates responses at runtime — it
 * returns parsed JSON cast to the declared type, so an unknown-to-this-type field is simply
 * invisible to a caller using this type, never rejected.
 */
export interface ScanResponse {
  spans: Span[];
  uncertainSpans: Span[];
  stats: AnonymizeStats;
}

export interface AnonymizeOptions {
  markerFormat?: MarkerFormat;
  ambiguous?: AmbiguousMode;
  /**
   * Honoured by a later server release (`--keep`). Silently ignored by today's server:
   * `AnonymizeRequest` is a non-strict zod object, so an unrecognized field is stripped, not
   * rejected — verified against `schemas.ts` and against the running dev server (2026-09-07:
   * sending `keep: ["DATE","URL"]` to `POST /api/v1/anonymize` returns 200 with no effect).
   */
  keep?: string[];
  /**
   * Honoured by a later server release (structure-preserving output). Silently ignored by
   * today's server, same non-strict-object reasoning as `keep` above.
   */
  structure?: string;
}

export interface AnonymizeFileOptions {
  filename: string;
  markerFormat?: MarkerFormat;
  outputFormat?: "docx" | "text";
  redactUncertain?: boolean;
}

export interface RestoreOptions {
  customMap?: Record<string, string>;
}

export interface RestoreResult {
  text: string;
  exact: number;
  fuzzy: number;
  missing: string[];
  unknown: string[];
}

export interface UnpiiOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}
