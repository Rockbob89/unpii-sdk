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
   * Categories to detect but leave as plain text (`DATE`, `URL`; typed loosely, the server validates). Pro and Ultra only: below that
   * the server answers 402 `tier_required` rather than ignoring the field.
   */
  keep?: string[];
  /** `auto` | `text` | `json` | `csv` (typed loosely, the server validates). Below Plus the server forces `text` without an error. */
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
