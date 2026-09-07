"""Client-side "Zurueckuebersetzen" (translate back): replace `[LABEL_n]`
markers in an LLM answer with the original PII text, using the `original`
field the anonymize response already carries per span.

Pure function, no I/O, no network call. This mirrors the TypeScript SDK's
`restore()` implementation field-for-field on purpose — `tests/test_restore_parity.py`
runs both implementations against the same JSON fixture of cases and fails
if they ever disagree.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .client import Span


@dataclass
class RestoreResult:
    text: str
    exact: int
    fuzzy: int
    missing: list[str]
    unknown: list[str]


@dataclass
class _Entry:
    label: str
    n: int
    original: str
    canonical: str


# Lookbehind/lookahead pair equivalent to the TypeScript implementation's
# `(?<![\p{L}\p{N}_])` / `(?![\p{L}\p{N}])`. Python's `re` module only
# allows fixed-width alternatives inside a lookbehind; `[^\W\d_]` (a `\w`
# character that is neither digit nor underscore, i.e. a Unicode letter —
# matching `\p{L}`), `\d` and `_` are each exactly one character wide, so
# this alternation is legal. Note the lookahead deliberately does NOT
# exclude `_` (matches the TS pattern exactly) — only the lookbehind does.
# The `[^\W\d_]` <-> `\p{L}` equivalence is verified with an umlaut/eszett
# case in tests/test_restore.py rather than assumed.
_BOUNDARY_BEFORE = r"(?<![^\W\d_]|\d|_)"
_BOUNDARY_AFTER = r"(?![^\W\d_]|\d)"

# Marker-shaped strings with no declared entry behind them, e.g. `PERSON_9`,
# `[PERSON_9]`, `EMAIL-1`, `EMAIL 1`. Deliberately ASCII-uppercase only:
# category names (and the default label form) are always uppercase English
# words, unlike a `customMap` value, which can be anything — that's why
# `customMap` values get their own scan pass below instead of relying on
# this pattern to catch them too.
_UNKNOWN_MARKER_RE = re.compile(r"\[?[A-Z][A-Z_]*[_\- ]?\d+\]?")


def _overlaps(start: int, end: int, claimed: list[tuple[int, int]]) -> bool:
    return any(start < c_end and end > c_start for c_start, c_end in claimed)


def restore(
    answer: str,
    spans: list[Span],
    custom_map: dict[str, str] | None = None,
) -> RestoreResult:
    custom_map = custom_map or {}

    # 1. Entries from spans, in order. Dedupe by "label_n" — first wins.
    entries: list[_Entry] = []
    seen: set[str] = set()
    for span in spans:
        label = custom_map.get(span.category, span.category)
        key = f"{label}_{span.id}"
        if key in seen:
            continue
        seen.add(key)
        entries.append(
            _Entry(label=label, n=span.id, original=span.original, canonical=f"[{label}_{span.id}]")
        )

    # 2. Replacement priority: label length desc, then n desc — so
    # PERSON_12 is tried before PERSON_1.
    ordered = sorted(entries, key=lambda e: (-len(e.label), -e.n))

    claimed: list[tuple[int, int]] = []
    claims: list[tuple[int, int, _Entry, bool]] = []  # start, end, entry, is_exact
    matched_keys: set[str] = set()

    # 3-5. Per-entry regex against the ORIGINAL answer; claim matches left to
    # right, skipping anything overlapping an already-claimed range.
    for entry in ordered:
        pattern = re.compile(
            _BOUNDARY_BEFORE
            + r"(\[)?"
            + re.escape(entry.label)
            + r"[ _-]?\s*"
            + re.escape(str(entry.n))
            + _BOUNDARY_AFTER
            + r"(\])?",
            re.IGNORECASE,
        )
        for m in pattern.finditer(answer):
            start, end = m.start(), m.end()
            if _overlaps(start, end, claimed):
                continue
            claimed.append((start, end))
            # Exact iff the matched text is the canonical `[LABEL_n]` form
            # exactly — brackets present, `_` separator, label in the
            # entry's own case (compared against the stored label, not
            # normalized against the matched text's case).
            is_exact = m.group(0) == entry.canonical
            claims.append((start, end, entry, is_exact))
            matched_keys.add(f"{entry.label}_{entry.n}")

    # 6-7. Splice claimed ranges left to right, replacing each with that
    # entry's original text.
    claims.sort(key=lambda c: c[0])
    pieces: list[str] = []
    cursor = 0
    exact = 0
    fuzzy = 0
    for start, end, entry, is_exact in claims:
        pieces.append(answer[cursor:start])
        pieces.append(entry.original)
        cursor = end
        if is_exact:
            exact += 1
        else:
            fuzzy += 1
    pieces.append(answer[cursor:])
    text = "".join(pieces)

    # 8. Missing: canonical markers of entries with zero claimed matches, in
    # entry order (the dedupe order from step 1, not the replacement order).
    missing = [e.canonical for e in entries if f"{e.label}_{e.n}" not in matched_keys]

    # 9. Unknown: marker-shaped strings in the ANSWER — never the output
    # `text` above — that no entry claimed. Scanning the answer is load-
    # bearing: a restored original can itself be marker-shaped (e.g.
    # "RECH-2026-003291" matches `[A-Z][A-Z_]*` + digits) and only exists in
    # `text` *after* substitution, so scanning the output would falsely
    # report it as unknown.
    candidates: list[tuple[int, int, str]] = []
    for m in _UNKNOWN_MARKER_RE.finditer(answer):
        candidates.append((m.start(), m.end(), m.group(0)))
    for value in custom_map.values():
        custom_pattern = re.compile(r"\[?" + re.escape(value) + r"[_\- ]?\d+\]?", re.IGNORECASE)
        for m in custom_pattern.finditer(answer):
            candidates.append((m.start(), m.end(), m.group(0)))

    candidates.sort(key=lambda c: (c[0], c[1]))
    unknown: list[str] = []
    seen_unknown: set[str] = set()
    for start, end, matched_text in candidates:
        if _overlaps(start, end, claimed):
            continue
        if matched_text in seen_unknown:
            continue
        seen_unknown.add(matched_text)
        unknown.append(matched_text)

    return RestoreResult(text=text, exact=exact, fuzzy=fuzzy, missing=missing, unknown=unknown)
