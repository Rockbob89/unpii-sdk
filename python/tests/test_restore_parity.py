"""Cross-language parity: `unpii_sdk.restore.restore()` (this package) and the
TypeScript SDK's `restore()` must agree, exactly, on every case in
tests/restore-cases.json. That file's own `_note` field says it plainly:
changing an `expect` value there changes the specified behaviour of BOTH
implementations, not just a test fixture. If a case here fails, fix THIS
package's restore.py — the JSON file is shared with the TypeScript SDK and
is not this package's to edit unilaterally.

File shape (one shared `spans` list, reused by every case; each case
supplies its own `answer` / `customMap` / `expect`):

    {
      "spans": [{"start", "end", "category", "id", "original", "score"?}, ...],
      "cases": [
        {"name": "...", "answer": "...", "customMap": {...} | null,
         "expect": {"text", "exact", "fuzzy", "missing", "unknown"}},
        ...
      ]
    }
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from unpii_sdk.client import Span
from unpii_sdk.restore import restore

CASES_PATH = Path(__file__).resolve().parent.parent.parent / "test-cases" / "restore-cases.json"

_DATA = json.loads(CASES_PATH.read_text())
_SPANS = [
    Span(
        start=item["start"],
        end=item["end"],
        category=item["category"],
        id=item["id"],
        original=item["original"],
        score=item.get("score"),
    )
    for item in _DATA["spans"]
]
_CASES: list[dict[str, Any]] = _DATA["cases"]


@pytest.mark.parametrize("case", _CASES, ids=[c["name"] for c in _CASES])
def test_restore_matches_typescript_implementation(case: dict[str, Any]) -> None:
    expect = case["expect"]

    result = restore(case["answer"], _SPANS, case.get("customMap"))

    assert result.text == expect["text"]
    assert result.exact == expect["exact"]
    assert result.fuzzy == expect["fuzzy"]
    assert result.missing == expect["missing"]
    assert result.unknown == expect["unknown"]
