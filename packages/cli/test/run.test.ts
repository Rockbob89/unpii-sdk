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

// renderScanTable's header row used to be a fixed English array
// (CATEGORY/ID/START/END/SCORE/STATUS) while the STATUS cells beneath it were already
// translated (scanStatusLabel) — a translated column under an untranslated header row is only
// half-finished. Both the header and the STATUS cells now come from messages.ts
// (scanTableHeaders/scanStatusLabel) and are passed the same `lang`. lang is passed explicitly
// here (never relying on the ambient LANG/LC_ALL of whatever process runs the suite).
describe("renderScanTable()", () => {
  it("English: header reads CATEGORY, STATUS reads 'confirmed'/'uncertain'", () => {
    const table = renderScanTable(
      { spans: [span()], uncertainSpans: [span({ id: 2, category: "PHONE" })] },
      "en",
    );
    const headerLine = table.split("\n")[0];
    expect(headerLine).toContain("CATEGORY");
    expect(headerLine).not.toContain("KATEGORIE");
    expect(table).toContain("confirmed");
    expect(table).toContain("uncertain");
    expect(table).not.toContain("sicher");
    expect(table).not.toContain("unsicher");
  });

  it("German: header reads KATEGORIE, STATUS reads 'sicher'/'unsicher'", () => {
    const table = renderScanTable(
      { spans: [span()], uncertainSpans: [span({ id: 2, category: "PHONE" })] },
      "de",
    );
    const headerLine = table.split("\n")[0];
    expect(headerLine).toContain("KATEGORIE");
    expect(headerLine).not.toContain("CATEGORY");
    expect(table).toContain("sicher");
    expect(table).toContain("unsicher");
  });
});
