import { describe, expect, it } from "vitest";
import { ArgsError, parseArgs } from "../src/args.js";
import { API_ERROR_MESSAGES, apiErrorMessage, helpText } from "../src/messages.js";

describe("parseArgs()", () => {
  it("defaults: no args reads stdin, no scan/json, no out/marker/keep", () => {
    const parsed = parseArgs([]);
    expect(parsed).toEqual({
      command: "run",
      help: false,
      version: false,
      path: undefined,
      out: undefined,
      scan: false,
      json: false,
      marker: undefined,
      keep: undefined,
    });
  });

  it("parses a positional path", () => {
    const parsed = parseArgs(["notiz.txt"]);
    expect(parsed).toMatchObject({ command: "run", path: "notiz.txt" });
  });

  it("--out <path>", () => {
    const parsed = parseArgs(["vertrag.docx", "--out", "vertrag.anon.docx"]);
    expect(parsed).toMatchObject({ path: "vertrag.docx", out: "vertrag.anon.docx" });
  });

  it("--scan", () => {
    const parsed = parseArgs(["--scan", "notiz.txt"]);
    expect(parsed).toMatchObject({ scan: true, path: "notiz.txt" });
  });

  it("--json", () => {
    const parsed = parseArgs(["--json", "notiz.txt"]);
    expect(parsed).toMatchObject({ json: true, path: "notiz.txt" });
  });

  it("--marker <format> accepts every real MarkerFormat value", () => {
    for (const format of ["default", "custom", "xxxxx", "blackbar"] as const) {
      const parsed = parseArgs(["--marker", format]);
      expect(parsed).toMatchObject({ marker: format });
    }
  });

  it("--marker with an invalid value throws ArgsError", () => {
    expect(() => parseArgs(["--marker", "bogus"])).toThrow(ArgsError);
  });

  it("--keep a,b splits into ['a', 'b']", () => {
    const parsed = parseArgs(["--keep", "a,b"]);
    expect(parsed).toMatchObject({ keep: ["a", "b"] });
  });

  it("--keep trims whitespace and drops empty entries", () => {
    const parsed = parseArgs(["--keep", " DATE , URL ,,"]);
    expect(parsed).toMatchObject({ keep: ["DATE", "URL"] });
  });

  it("--help", () => {
    const parsed = parseArgs(["--help"]);
    expect(parsed).toMatchObject({ help: true });
  });

  it("--version", () => {
    const parsed = parseArgs(["--version"]);
    expect(parsed).toMatchObject({ version: true });
  });

  it("--help skips marker-value validation (a bogus value doesn't blow up help)", () => {
    expect(() => parseArgs(["--help", "--marker", "bogus"])).not.toThrow();
  });

  it("restore subcommand with --from", () => {
    const parsed = parseArgs(["restore", "--from", "result.json", "answer.md"]);
    expect(parsed).toEqual({
      command: "restore",
      help: false,
      version: false,
      from: "result.json",
      path: "answer.md",
      out: undefined,
    });
  });

  it("restore without --from throws ArgsError", () => {
    expect(() => parseArgs(["restore"])).toThrow(ArgsError);
  });

  it("restore --help does not require --from", () => {
    expect(() => parseArgs(["restore", "--help"])).not.toThrow();
    expect(parseArgs(["restore", "--help"])).toMatchObject({ command: "restore", help: true });
  });

  it("restore accepts --out to redirect the restored text", () => {
    const parsed = parseArgs(["restore", "--from", "r.json", "--out", "plain.md"]);
    expect(parsed).toMatchObject({ out: "plain.md" });
  });

  it("more than one positional path is rejected", () => {
    expect(() => parseArgs(["a.txt", "b.txt"])).toThrow(ArgsError);
  });

  it("more than one positional after 'restore' is rejected", () => {
    expect(() => parseArgs(["restore", "--from", "r.json", "a.md", "b.md"])).toThrow(ArgsError);
  });

  describe("--key is not a valid option (Charter: shell history)", () => {
    it("is rejected as an unknown option", () => {
      expect(() => parseArgs(["--key", "sk_live_something"])).toThrow(ArgsError);
    });

    it("never appears in the help text", () => {
      expect(helpText()).not.toContain("--key");
    });
  });

  it("an unrelated unknown option is rejected the same way (usage error → exit 2 path)", () => {
    let caught: unknown;
    try {
      parseArgs(["--does-not-exist"]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ArgsError);
  });
});

describe("API_ERROR_MESSAGES / apiErrorMessage()", () => {
  const EXPECTED_CODES = [
    "account_tier_required",
    "tier_required",
    "rate_limited_burst",
    "daily_budget_exceeded",
    "char_limit_exceeded",
    "busy",
    "turnstile_required",
    "invalid_file",
    "file_too_large",
    "too_many_pages",
    "encrypted_file",
    "no_text_layer",
    "unsupported_output_format",
    "invalid_field",
    "custom_rules_timeout",
    "processing_error",
  ].sort();

  it("both languages cover exactly the codes the server actually emits (anonymize.ts / anonymize-file.ts)", () => {
    expect(Object.keys(API_ERROR_MESSAGES.de).sort()).toEqual(EXPECTED_CODES);
    expect(Object.keys(API_ERROR_MESSAGES.en).sort()).toEqual(EXPECTED_CODES);
  });

  it.each(["de", "en"] as const)(
    "every %s code produces a distinct, non-empty sentence with no leaked '{' or raw code",
    (lang) => {
      const table = API_ERROR_MESSAGES[lang];
      const codes = Object.keys(table);
      const sentences = codes.map((code) => table[code]);
      for (const [i, sentence] of sentences.entries()) {
        expect(sentence, `${lang} code ${codes[i]}`).toBeTruthy();
        expect(sentence, `${lang} code ${codes[i]}`).not.toContain("{");
        // The sentence never merely echoes the wire code back at the user.
        expect(sentence?.toLowerCase(), `${lang} code ${codes[i]}`).not.toContain(
          (codes[i] ?? "").toLowerCase(),
        );
      }
      expect(new Set(sentences).size).toBe(sentences.length);
    },
  );

  it.each(["de", "en"] as const)(
    "an unmapped code falls back to a generic %s sentence naming only the HTTP status",
    (lang) => {
      const message = apiErrorMessage({ code: "totally_unknown_code", status: 503 }, lang);
      expect(message).toContain("503");
      expect(message).not.toContain("totally_unknown_code");
      expect(message).not.toContain("{");
    },
  );

  it.each(["de", "en"] as const)(
    "an absent code (undefined) also falls back to the generic %s sentence",
    (lang) => {
      const message = apiErrorMessage({ code: undefined, status: 500 }, lang);
      expect(message).toContain("500");
      expect(message).not.toContain("{");
    },
  );
});
