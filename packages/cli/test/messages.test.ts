import type { RestoreResult, UnpiiError } from "@unpii/sdk";
import { describe, expect, it } from "vitest";
import {
  API_ERROR_MESSAGES,
  type Lang,
  answerReadFailedMessage,
  apiErrorMessage,
  fromReadFailedMessage,
  genericErrorMessage,
  helpText,
  inputReadFailedMessage,
  invalidArgumentsMessage,
  invalidJsonMessage,
  invalidMarkerMessage,
  invalidResponseMessage,
  missingSpansArrayMessage,
  noApiKeyMessage,
  outRequiredForDocumentMessage,
  rateLimitSentence,
  resolveLang,
  restoreNeedsFromMessage,
  restoreSummary,
  scanNotAvailableMessage,
  scanStatusLabel,
  tooManyPathsMessage,
  unexpectedErrorMessage,
} from "../src/messages.js";

describe("resolveLang()", () => {
  it.each([
    { name: "LANG=de_DE.UTF-8 -> de", env: { LANG: "de_DE.UTF-8" }, expected: "de" },
    { name: "LC_ALL=de_AT -> de", env: { LC_ALL: "de_AT" }, expected: "de" },
    { name: "LANG=C -> en", env: { LANG: "C" }, expected: "en" },
    { name: "LANG=en_US.UTF-8 -> en", env: { LANG: "en_US.UTF-8" }, expected: "en" },
    {
      name: "LC_ALL=de_DE beats a conflicting LANG=en_US -> de",
      env: { LC_ALL: "de_DE", LANG: "en_US.UTF-8" },
      expected: "de",
    },
    {
      name: "LC_ALL=en_US beats a conflicting LANG=de_DE -> en",
      env: { LC_ALL: "en_US.UTF-8", LANG: "de_DE.UTF-8" },
      expected: "en",
    },
    { name: "DE (bare, uppercase) -> de", env: { LANG: "DE" }, expected: "de" },
    { name: "empty LANG, no LC_ALL -> en", env: { LANG: "" }, expected: "en" },
    { name: "empty LANG and empty LC_ALL -> en", env: { LANG: "", LC_ALL: "" }, expected: "en" },
    { name: "neither set -> en", env: {}, expected: "en" },
  ] satisfies Array<{ name: string; env: NodeJS.ProcessEnv; expected: Lang }>)(
    "$name",
    ({ env, expected }) => {
      expect(resolveLang(env)).toBe(expected);
    },
  );
});

describe("message functions: German and English differ, both non-empty", () => {
  it("noApiKeyMessage", () => {
    const de = noApiKeyMessage("de");
    const en = noApiKeyMessage("en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("outRequiredForDocumentMessage", () => {
    const de = outRequiredForDocumentMessage("de");
    const en = outRequiredForDocumentMessage("en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("scanNotAvailableMessage", () => {
    const de = scanNotAvailableMessage("de");
    const en = scanNotAvailableMessage("en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("apiErrorMessage, for a mapped code", () => {
    const err: Pick<UnpiiError, "code" | "status"> = { code: "busy", status: 503 };
    const de = apiErrorMessage(err, "de");
    const en = apiErrorMessage(err, "en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("apiErrorMessage, for the unmapped-code fallback", () => {
    const err: Pick<UnpiiError, "code" | "status"> = { code: undefined, status: 503 };
    const de = apiErrorMessage(err, "de");
    const en = apiErrorMessage(err, "en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("rateLimitSentence", () => {
    const de = rateLimitSentence(3, 100, 30, "de");
    const en = rateLimitSentence(3, 100, 30, "en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("restoreSummary", () => {
    const result: RestoreResult = {
      text: "irrelevant",
      exact: 2,
      fuzzy: 1,
      missing: ["PERSON 2"],
      unknown: ["PHONE 9"],
    };
    const de = restoreSummary(result, "de");
    const en = restoreSummary(result, "en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("helpText", () => {
    const de = helpText("de");
    const en = helpText("en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  // Plan 08b T3b: the nine messages left behind in args.ts/run.ts (plus two more found by grep:
  // run.ts's --from defensive fallback, which reuses restoreNeedsFromMessage, and cli.ts's
  // catch-all), moved here so they carry the same bilingual coverage as everything above.
  it("invalidArgumentsMessage", () => {
    const de = invalidArgumentsMessage("Unknown option '--bogus'", "de");
    const en = invalidArgumentsMessage("Unknown option '--bogus'", "en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("tooManyPathsMessage", () => {
    const de = tooManyPathsMessage("de");
    const en = tooManyPathsMessage("en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("restoreNeedsFromMessage", () => {
    const de = restoreNeedsFromMessage("de");
    const en = restoreNeedsFromMessage("en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("invalidMarkerMessage", () => {
    const de = invalidMarkerMessage("bogus", "default, custom, xxxxx, blackbar", "de");
    const en = invalidMarkerMessage("bogus", "default, custom, xxxxx, blackbar", "en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("missingSpansArrayMessage", () => {
    const de = missingSpansArrayMessage("de");
    const en = missingSpansArrayMessage("en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("invalidJsonMessage", () => {
    const de = invalidJsonMessage("de");
    const en = invalidJsonMessage("en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("fromReadFailedMessage", () => {
    const de = fromReadFailedMessage("ENOENT: no such file", "de");
    const en = fromReadFailedMessage("ENOENT: no such file", "en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("answerReadFailedMessage", () => {
    const de = answerReadFailedMessage("ENOENT: no such file", "de");
    const en = answerReadFailedMessage("ENOENT: no such file", "en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("inputReadFailedMessage", () => {
    const de = inputReadFailedMessage("ENOENT: no such file", "de");
    const en = inputReadFailedMessage("ENOENT: no such file", "en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("invalidResponseMessage", () => {
    const de = invalidResponseMessage("de");
    const en = invalidResponseMessage("en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("genericErrorMessage", () => {
    const de = genericErrorMessage("boom", "de");
    const en = genericErrorMessage("boom", "en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });

  it("unexpectedErrorMessage", () => {
    const de = unexpectedErrorMessage("boom", "de");
    const en = unexpectedErrorMessage("boom", "en");
    expect(de.trim().length).toBeGreaterThan(0);
    expect(en.trim().length).toBeGreaterThan(0);
    expect(de).not.toBe(en);
  });
});

describe("scanStatusLabel()", () => {
  // Plan 08b T6: --scan's STATUS column was hardcoding the German words even under the
  // English default (headers are English, the cells said "unsicher"/"sicher" regardless).
  it("uncertain span, German", () => {
    expect(scanStatusLabel(true, "de")).toBe("unsicher");
  });

  it("uncertain span, English — not the German word", () => {
    const en = scanStatusLabel(true, "en");
    expect(en.trim().length).toBeGreaterThan(0);
    expect(en).not.toBe("unsicher");
  });

  it("confirmed span, German", () => {
    expect(scanStatusLabel(false, "de")).toBe("sicher");
  });

  it("confirmed span, English — not the German word", () => {
    const en = scanStatusLabel(false, "en");
    expect(en.trim().length).toBeGreaterThan(0);
    expect(en).not.toBe("sicher");
  });

  it("the two English labels are distinct from each other", () => {
    expect(scanStatusLabel(true, "en")).not.toBe(scanStatusLabel(false, "en"));
  });
});

describe("API_ERROR_MESSAGES key-set invariant", () => {
  it("German and English declare exactly the same set of error codes", () => {
    // The invariant that matters: an unmapped code silently falls back to the generic
    // "unknown error" sentence, so a code present in one language and missing in the other
    // would never surface as an error — it would just look like a slightly worse message.
    expect(Object.keys(API_ERROR_MESSAGES.de).sort()).toEqual(
      Object.keys(API_ERROR_MESSAGES.en).sort(),
    );
  });
});
