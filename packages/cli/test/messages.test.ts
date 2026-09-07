import type { RestoreResult, UnpiiError } from "@unpii/sdk";
import { describe, expect, it } from "vitest";
import {
  API_ERROR_MESSAGES,
  type Lang,
  apiErrorMessage,
  helpText,
  noApiKeyMessage,
  outRequiredForDocumentMessage,
  rateLimitSentence,
  resolveLang,
  restoreSummary,
  scanNotAvailableMessage,
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
