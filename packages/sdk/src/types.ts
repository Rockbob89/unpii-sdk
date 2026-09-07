import type { AmbiguousMode, AnonymizeStats, MarkerFormat, Span } from "./types.generated.js";

/**
 * Response of `POST /api/v1/scan`. That route does not exist yet on today's server — it is
 * specified in `docs/superpowers/plans/2026-09-07-launch-03-api-antwort.md`, and this type
 * follows that contract ahead of the server shipping it. Extra fields the server later adds
 * (e.g. `receipt`) are tolerated because the SDK never validates responses at runtime — it
 * returns parsed JSON cast to the declared type, so an unknown-to-this-type field is simply
 * invisible to a caller using this type, never rejected.
 */
export interface ScanResponse {
  spans: Span[];
  uncertainSpans: Span[];
  stats: AnonymizeStats;
}

/**
 * Response of `GET /api/v1/limits`, hand-mirrored from `apps/api/src/routes/limits.ts` rather
 * than generated. `shared/schemas.ts`'s `LimitsResponse` has the same shape (deprecated legacy
 * fields included) but is deliberately not one of the 8 schemas `gen-types.ts` generates — only
 * the anonymize/file response family is — so this is typed by hand against the real route
 * response instead. `anonymize` and `auth` are the deprecated top-level groups; see the route's
 * own comments for their `reference`/`burst` replacements.
 */
export interface LimitsResponse {
  current: {
    tier: "anon" | "free" | "docs" | "api" | "pro" | "ultra";
    channel: "web" | "api";
    daily_limit: number;
    entitled: boolean;
  };
  reference: {
    web: {
      anon: number;
      free: number;
      docs: number;
      api: number;
      pro: number;
      ultra: number;
    };
    api: {
      free: number;
      docs: number;
      api: number;
      pro: number;
      ultra: number;
    };
  };
  burst: {
    magic_link_per_hour: number;
  };
  /** @deprecated Use `reference.web`/`reference.api` instead — kept because the server still
   * sends it. */
  anonymize: {
    anonymous_per_day: number;
    user_per_day: number;
    apikey_per_day: number;
  };
  /** @deprecated Use `burst.magic_link_per_hour` instead — kept because the server still sends
   * it. */
  auth: {
    magic_link_per_hour: number;
  };
}

export interface AnonymizeOptions {
  markerFormat?: MarkerFormat;
  ambiguous?: AmbiguousMode;
  /**
   * Honoured by Session 05 (`--keep`). Silently ignored by today's server: `AnonymizeRequest`
   * is a non-strict zod object, so an unrecognized field is stripped, not rejected — verified
   * against `schemas.ts` and against the running dev server (2026-09-07: sending
   * `keep: ["DATE","URL"]` to `POST /api/v1/anonymize` returns 200 with no effect).
   */
  keep?: string[];
  /**
   * Honoured by Session 07 (structure-preserving output). Silently ignored by today's server,
   * same non-strict-object reasoning as `keep` above.
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
