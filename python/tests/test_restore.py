"""Unit tests for unpii.restore.restore(). Fixture-derived where the answer
text and span data matter (fixtures/anonymize.docs.json, the same real
server capture the TypeScript SDK's tests use), matching the three
acceptance criteria captured when this restore-back feature shipped
(adapted from the browser UI to the API-side function under test here).
"""

from __future__ import annotations

import json
from pathlib import Path

from unpii.client import Span
from unpii.restore import restore

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "fixtures"


def _fixture_spans() -> list[Span]:
    data = json.loads((FIXTURES_DIR / "anonymize.docs.json").read_text())
    return [
        Span(
            start=s["start"],
            end=s["end"],
            category=s["category"],
            id=s["id"],
            original=s["original"],
            score=s.get("score"),
        )
        for s in data["spans"]
    ]


# The 10 fixture spans, in order: PERSON_1 "Anne Schmitz", DATE_1
# "15.03.2026", EMAIL_1, PHONE_1, ADDRESS_1, URL_1, ACCOUNT_1, ACCOUNT_2
# "RECH-2026-003291", SECRET_1, PERSON_2 "hans schmidt".


def test_abnahme_a_two_exact_markers() -> None:
    spans = _fixture_spans()
    answer = "Bitte [PERSON_1] vor dem [DATE_1] anrufen."

    result = restore(answer, spans)

    assert result.exact == 2
    assert result.fuzzy == 0
    assert result.text == "Bitte Anne Schmitz vor dem 15.03.2026 anrufen."
    assert len(result.missing) == len(spans) - 2
    assert "[PERSON_1]" not in result.missing
    assert "[DATE_1]" not in result.missing
    assert result.unknown == []


def test_abnahme_b_without_custom_map_only_person_and_phone_match() -> None:
    spans = _fixture_spans()
    answer = "Bitte Person 1 vor dem Datum 1 anrufen, [PHONE 1] steht in der Mail."

    result = restore(answer, spans)

    # "Datum 1" never matches DATE_1 without a customMap entry mapping
    # DATE -> "Datum" — it's left as untouched plain text, not missing
    # (it never looked like a marker in the first place) and not unknown
    # (it isn't ALL-CAPS, so it never matches the unknown-marker pattern).
    assert result.exact == 0
    assert result.fuzzy == 2  # "Person 1" (no brackets) and "[PHONE 1]" (wrong separator)
    assert "Anne Schmitz" in result.text
    assert "+49 89 9876543" in result.text
    assert "Datum 1" in result.text  # untouched
    assert result.unknown == []


def test_abnahme_b_with_custom_map_three_fuzzy_matches() -> None:
    spans = _fixture_spans()
    answer = "Bitte Person 1 vor dem Datum 1 anrufen, [PHONE 1] steht in der Mail."

    result = restore(answer, spans, custom_map={"DATE": "Datum"})

    assert result.exact == 0
    assert result.fuzzy == 3
    assert "15.03.2026" in result.text
    assert "Datum 1" not in result.text


def test_abnahme_c_unknown_marker_nothing_inserted() -> None:
    spans = _fixture_spans()
    answer = "Die Kundin ruft morgen an. [PERSON_9] auch."

    result = restore(answer, spans)

    assert result.exact == 0
    assert result.fuzzy == 0
    assert result.text == answer
    assert result.unknown == ["[PERSON_9]"]
    assert len(result.missing) == len(spans)


# --- boundary / precedence -------------------------------------------


def test_person_1_is_not_matched_inside_person_12() -> None:
    spans = [Span(start=0, end=4, category="PERSON", id=1, original="Anne")]

    result = restore("Bitte PERSON_12 informieren.", spans)

    assert result.missing == ["[PERSON_1]"]
    assert "Anne" not in result.text
    assert result.unknown == ["PERSON_12"]


def test_person_12_tried_before_person_1_when_both_exist() -> None:
    spans = [
        Span(start=0, end=4, category="PERSON", id=1, original="Anne"),
        Span(start=0, end=4, category="PERSON", id=12, original="Otto"),
    ]

    result = restore("[PERSON_12] und [PERSON_1] kommen.", spans)

    assert "Otto" in result.text
    assert "Anne" in result.text
    assert result.exact == 2
    assert result.missing == []
    assert result.unknown == []


def test_umlaut_eszett_boundary_blocks_marker_glued_to_a_word() -> None:
    """`[^\\W\\d_]` (the Python stand-in for `\\p{L}`) must classify `ß` as a
    letter — same as any other Unicode letter — so a marker glued directly
    onto a word ending in it does NOT match. Verified directly, per the
    dispatch instructions, rather than assumed equivalent to the TS
    `\\p{L}` lookbehind."""
    spans = [Span(start=0, end=4, category="PERSON", id=1, original="Anne")]

    glued = restore("Sie wohnt in der großPERSON_1 heute.", spans)
    assert glued.missing == ["[PERSON_1]"]
    assert "Anne" not in glued.text

    separated = restore("Sie wohnt in der groß PERSON_1 heute.", spans)
    assert separated.exact + separated.fuzzy == 1
    assert "Anne" in separated.text


def test_umlaut_in_the_replaced_original_itself() -> None:
    """The umlaut sits in the *replacement* text this time (Schellingstraße),
    not the boundary — a plain end-to-end sanity check that non-ASCII
    `original` values pass through untouched."""
    spans = [
        Span(start=0, end=0, category="ADDRESS", id=1, original="Schellingstraße 42, 80799 München")
    ]

    result = restore("Bitte an [ADDRESS_1] liefern.", spans)

    assert result.text == "Bitte an Schellingstraße 42, 80799 München liefern."
    assert result.exact == 1


# --- exact vs fuzzy, separators, case -----------------------------------


def test_exact_requires_brackets_underscore_and_entry_case() -> None:
    spans = [Span(start=0, end=6, category="PERSON", id=1, original="Anne")]

    exact = restore("[PERSON_1]", spans)
    assert exact.exact == 1
    assert exact.fuzzy == 0

    no_brackets = restore("PERSON_1", spans)
    assert no_brackets.exact == 0
    assert no_brackets.fuzzy == 1

    dash_separator = restore("[PERSON-1]", spans)
    assert dash_separator.exact == 0
    assert dash_separator.fuzzy == 1

    space_separator = restore("PERSON 1", spans)
    assert space_separator.exact == 0
    assert space_separator.fuzzy == 1

    lowercase = restore("[person_1]", spans)
    assert lowercase.exact == 0
    assert lowercase.fuzzy == 1


def test_multiple_occurrences_of_the_same_marker_all_replaced() -> None:
    spans = [Span(start=0, end=6, category="PERSON", id=1, original="Anne")]

    result = restore("[PERSON_1] traf [PERSON_1] wieder.", spans)

    assert result.text == "Anne traf Anne wieder."
    assert result.exact == 2
    assert result.missing == []


# --- dedupe ------------------------------------------------------------


def test_duplicate_span_same_category_and_id_deduped_first_wins() -> None:
    spans = [
        Span(start=0, end=4, category="PERSON", id=1, original="Anne"),
        Span(start=20, end=24, category="PERSON", id=1, original="SHOULD_NOT_WIN"),
    ]

    result = restore("[PERSON_1]", spans)

    assert result.text == "Anne"
    assert result.missing == []


# --- custom_map ----------------------------------------------------------


def test_custom_map_relabels_and_matches_exactly_on_matching_case() -> None:
    spans = [Span(start=0, end=4, category="PERSON", id=1, original="Anne")]

    result = restore("Bitte [Name_1] anrufen.", spans, custom_map={"PERSON": "Name"})

    assert result.text == "Bitte Anne anrufen."
    assert result.exact == 1
    assert result.fuzzy == 0


def test_custom_map_value_participates_in_unknown_scan() -> None:
    """`[A-Z][A-Z_]*` alone would miss `Name_9` (mixed case) — this is why
    every custom_map VALUE gets its own case-insensitive scan pass."""
    spans = [Span(start=0, end=4, category="PERSON", id=1, original="Anne")]

    result = restore("Bitte [Name_1] und [Name_9] anrufen.", spans, custom_map={"PERSON": "Name"})

    assert result.text == "Bitte Anne und [Name_9] anrufen."
    assert result.exact == 1
    assert result.unknown == ["[Name_9]"]


# --- edge cases ----------------------------------------------------------


def test_empty_spans_answer_is_untouched_and_nothing_missing() -> None:
    result = restore("Hallo [PERSON_1] Welt.", [])

    assert result.text == "Hallo [PERSON_1] Welt."
    assert result.exact == 0
    assert result.fuzzy == 0
    assert result.missing == []
    assert result.unknown == ["[PERSON_1]"]


def test_empty_answer() -> None:
    spans = [Span(start=0, end=4, category="PERSON", id=1, original="Anne")]

    result = restore("", spans)

    assert result.text == ""
    assert result.missing == ["[PERSON_1]"]
    assert result.unknown == []


def test_answer_with_no_markers_at_all() -> None:
    spans = _fixture_spans()

    result = restore("Klingt gut, bis morgen dann.", spans)

    assert result.text == "Klingt gut, bis morgen dann."
    assert result.exact == 0
    assert result.fuzzy == 0
    assert len(result.missing) == len(spans)
    assert result.unknown == []


def test_unknown_never_leaks_a_restored_original_from_the_output() -> None:
    """A restored original can itself be marker-shaped (RECH-2026-003291 is
    an ACCOUNT span's `original` in the fixture and matches the unknown
    scan's `[A-Z][A-Z_]*` + digits pattern). Scanning the ANSWER, not the
    output `text`, is what keeps it out of `unknown` — this is the exact
    trap called out in the dispatch instructions."""
    spans = _fixture_spans()  # includes ACCOUNT_2 = "RECH-2026-003291"
    answer = "Rechnungsnummer [ACCOUNT_2] bitte pruefen."

    result = restore(answer, spans)

    assert "RECH-2026-003291" in result.text
    assert result.unknown == []
