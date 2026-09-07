// GENERATED FILE — DO NOT EDIT BY HAND.
// Produced by packages/sdk/scripts/gen-types.ts from packages/shared/src/schemas.ts.
// Run `pnpm --filter @unpii/sdk gen:types` to regenerate after a schema change.

export type MarkerFormat = "default" | "custom" | "xxxxx" | "blackbar";

export type AmbiguousMode = "redact" | "keep" | "mark";

export interface Span {
  start: number;
  end: number;
  category: string;
  id: number;
  original: string;
  score?: number;
}

export interface AnonymizeStats {
  request_id: string;
  processed_chars: number;
  servedBy: "slow" | "fast" | "gpu";
}

export interface AnonymizeResponse {
  anonymized: string;
  spans: Span[];
  uncertainSpans: Span[];
  stats: AnonymizeStats;
}

export interface FileWarning {
  code: string;
  detail: string;
  [key: string]: unknown;
}

export interface AnonymizeFileResponse {
  file: {
    name: string;
    mimeType: string;
    contentBase64: string;
  };
  spans: Span[];
  uncertainSpans: Span[];
  warnings: FileWarning[];
  stats: {
    request_id: string;
    extractedChars: number;
    servedBy: string;
  };
}

/**
 * `stats` mirrors `AnonymizeFileResponse.stats` structurally: in schemas.ts it is literally
 * `AnonymizeFileResponse.shape.stats`, the same object. This generator's named-reference
 * check (`namedRefFor` in gen-types.ts) only matches the 8 top-level schema constants by
 * identity, and that nested property access is not one of them, so it renders inline below
 * instead of as a `stats: AnonymizeFileResponse["stats"]` reference. The two shapes cannot
 * drift apart at the source (same object) even though the generated TypeScript can't say so.
 */
export interface AnonymizeFileTextResponse {
  text: string;
  spans: Span[];
  uncertainSpans: Span[];
  warnings: FileWarning[];
  stats: {
    request_id: string;
    extractedChars: number;
    servedBy: string;
  };
}
