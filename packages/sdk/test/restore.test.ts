import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { restore } from "../src/restore.js";
import type { Span } from "../src/types.generated.js";

interface RestoreCase {
  name: string;
  answer: string;
  customMap: Record<string, string> | null;
  expect: {
    text: string;
    exact: number;
    fuzzy: number;
    missing: string[];
    unknown: string[];
  };
}

interface RestoreCasesFile {
  _note: string;
  spans: Span[];
  cases: RestoreCase[];
}

const CASES_PATH = fileURLToPath(
  new URL("../../../test-cases/restore-cases.json", import.meta.url),
);
const fixture: RestoreCasesFile = JSON.parse(readFileSync(CASES_PATH, "utf8"));

describe("restore()", () => {
  it.each(fixture.cases)("$name", (testCase) => {
    const result = restore(testCase.answer, fixture.spans, {
      customMap: testCase.customMap ?? undefined,
    });
    expect(result).toEqual(testCase.expect);
  });
});
