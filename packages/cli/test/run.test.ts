import type { Span } from "@unpii/sdk";
import { describe, expect, it } from "vitest";
import { renderScanTable } from "../src/run.js";

function span(overrides: Partial<Span> = {}): Span {
  return {
    start: 0,
    end: 5,
    category: "PERSON",
    id: 1,
    original: "Anne",
    score: 0.9,
    ...overrides,
  };
}

// renderScanTable's STATUS column was hardcoded to the German words ("unsicher" / "sicher") no
// matter the resolved language — visibly broken under the English default a header row of
// CATEGORY/ID/START/END/SCORE/STATUS implies. lang is passed explicitly here
// (never relying on the ambient LANG/LC_ALL of whatever process runs the suite).
describe("renderScanTable()", () => {
  it("English: STATUS reads 'confirmed'/'uncertain', never the German words", () => {
    const table = renderScanTable(
      { spans: [span()], uncertainSpans: [span({ id: 2, category: "PHONE" })] },
      "en",
    );
    expect(table).toContain("confirmed");
    expect(table).toContain("uncertain");
    expect(table).not.toContain("sicher");
    expect(table).not.toContain("unsicher");
  });

  it("German: STATUS reads 'sicher'/'unsicher'", () => {
    const table = renderScanTable(
      { spans: [span()], uncertainSpans: [span({ id: 2, category: "PHONE" })] },
      "de",
    );
    expect(table).toContain("sicher");
    expect(table).toContain("unsicher");
  });
});
