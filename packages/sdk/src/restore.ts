import type { Span } from "./types.generated.js";
import type { RestoreOptions, RestoreResult } from "./types.js";

interface RestoreEntry {
  label: string;
  n: number;
  original: string;
  canonical: string;
  matched: boolean;
}

interface Claim {
  start: number;
  end: number;
  entry: RestoreEntry;
  exact: boolean;
}

interface Found {
  start: number;
  end: number;
  text: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One regex per entry, built fresh per call so state (`lastIndex`) never leaks between
 * invocations. Flags `giu`: global (all occurrences), case-insensitive (label case is not
 * required to match — that's exactly what makes a hit FUZZY instead of EXACT), unicode (so
 * `\p{L}`/`\p{N}` below are real Unicode letter/number classes, not the ASCII-only `\w`). */
function entryPattern(entry: RestoreEntry): RegExp {
  const label = escapeRegex(entry.label);
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])(\\[)?${label}[ _-]?\\s*${entry.n}(?![\\p{L}\\p{N}])(\\])?`,
    "giu",
  );
}

const MARKER_SHAPE_RE = /\[?[A-Z][A-Z_]*[_\- ]?\d+\]?/gu;

/**
 * Restores `[LABEL_n]`-shaped markers in `answer` back to the original values from `spans` (an
 * `/anonymize` or `/scan` response). Pure function: no I/O, no network, deterministic on its
 * inputs.
 *
 * This is the CONTRACT the Python port in this same repo (`python/src/unpii/restore.py`) has to
 * match exactly — both read `test-cases/restore-cases.json` and must produce byte-identical
 * results on every case there. See that file's `_note` before changing an expectation.
 */
export function restore(answer: string, spans: Span[], opts?: RestoreOptions): RestoreResult {
  // 1. Build entries from spans, deduped by "label_n" (first wins).
  const entries: RestoreEntry[] = [];
  const seenKeys = new Set<string>();
  for (const span of spans) {
    const label = opts?.customMap?.[span.category] ?? span.category;
    const n = span.id;
    const key = `${label}_${n}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    entries.push({
      label,
      n,
      original: span.original,
      canonical: `[${label}_${n}]`,
      matched: false,
    });
  }

  // 2. Replacement priority: longer labels first, then higher n first — so "PERSON_12" is
  // tried (and can claim its own range) before "PERSON_1" gets a chance to match a prefix of it.
  const ordered = [...entries].sort((a, b) => {
    if (b.label.length !== a.label.length) return b.label.length - a.label.length;
    return b.n - a.n;
  });

  // 3-4. Claim matches per entry, in priority order; a match overlapping an already-claimed
  // range is skipped. Claims accumulate regardless of textual position — they're sorted by
  // position afterward, once, to build `text`.
  const claims: Claim[] = [];
  const overlapsClaimed = (start: number, end: number): boolean =>
    claims.some((claim) => start < claim.end && end > claim.start);

  for (const entry of ordered) {
    for (const match of answer.matchAll(entryPattern(entry))) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (overlapsClaimed(start, end)) continue;
      // 5. EXACT iff the matched text is byte-identical to the canonical "[LABEL_n]" — brackets
      // present, "_" separator, label in the entry's own case. Anything the tolerant regex
      // accepted beyond that (missing brackets, " "/"-" separator, different case) is FUZZY.
      const exact = match[0] === entry.canonical;
      claims.push({ start, end, entry, exact });
      entry.matched = true;
    }
  }

  // 6. Rebuild the text with every claimed range replaced by its entry's original, left to
  // right. Claims are non-overlapping by construction, so a single left-to-right pass over the
  // position-sorted claims is enough.
  const sortedClaims = [...claims].sort((a, b) => a.start - b.start);
  let text = "";
  let cursor = 0;
  for (const claim of sortedClaims) {
    text += answer.slice(cursor, claim.start) + claim.entry.original;
    cursor = claim.end;
  }
  text += answer.slice(cursor);

  // 7. Counts.
  let exact = 0;
  let fuzzy = 0;
  for (const claim of claims) {
    if (claim.exact) exact++;
    else fuzzy++;
  }

  // 8. Missing: entries nothing claimed, in the order they were built (step 1 / span order).
  const missing = entries.filter((entry) => !entry.matched).map((entry) => entry.canonical);

  // 9. Unknown: marker-shaped strings in the ANSWER — never the rebuilt `text` — that nothing
  // claimed. A restored original can itself look marker-shaped (e.g. ACCOUNT_2's original
  // "RECH-2026-003291" matches MARKER_SHAPE_RE), and scanning the OUTPUT would misreport it as
  // unknown; scanning the ANSWER is what keeps that region attributed to the marker that was
  // actually there ("[ACCOUNT_2]", already claimed and excluded below) instead of the text that
  // replaced it. See test/restore.test.ts and test-cases/restore-cases.json for the case this
  // guards against — do not change this to scan `text`.
  const found: Found[] = [];
  for (const match of answer.matchAll(MARKER_SHAPE_RE)) {
    const start = match.index ?? 0;
    found.push({ start, end: start + match[0].length, text: match[0] });
  }
  if (opts?.customMap) {
    for (const value of Object.values(opts.customMap)) {
      const pattern = new RegExp(`\\[?${escapeRegex(value)}[_\\- ]?\\d+\\]?`, "gi");
      for (const match of answer.matchAll(pattern)) {
        const start = match.index ?? 0;
        found.push({ start, end: start + match[0].length, text: match[0] });
      }
    }
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const unknown: string[] = [];
  const seenUnknown = new Set<string>();
  for (const candidate of found) {
    if (overlapsClaimed(candidate.start, candidate.end)) continue;
    if (seenUnknown.has(candidate.text)) continue;
    seenUnknown.add(candidate.text);
    unknown.push(candidate.text);
  }

  return { text, exact, fuzzy, missing, unknown };
}
