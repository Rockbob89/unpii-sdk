import type { RestoreResult, UnpiiError } from "@unpii/sdk";

/** The two output languages the CLI speaks. English is the default — the npm audience is
 * international — with German available via `LANG`/`LC_ALL` for the audience the original
 * sentences were written for. */
export type Lang = "de" | "en";

/**
 * Resolves the CLI's output language from the process environment.
 *
 * `LC_ALL` overrides `LANG` unconditionally when it carries a value — that is the fixed lookup
 * order `setlocale(3)` uses (POSIX: `LC_ALL` beats every individual `LC_*` category variable,
 * which in turn beats `LANG`). An empty value is treated the same as unset, matching how glibc
 * treats an empty locale variable, so an empty `LC_ALL` falls through to `LANG` rather than
 * forcing English by itself. Whatever value wins, only its language prefix matters: anything
 * starting with "de" (case-insensitive — "de_DE.UTF-8", "de_AT", "DE", ...) selects German;
 * everything else, including no value at all, selects English.
 */
export function resolveLang(env: NodeJS.ProcessEnv): Lang {
  const lcAll = env.LC_ALL;
  const lang = env.LANG;
  const value = lcAll !== undefined && lcAll !== "" ? lcAll : lang;
  return value !== undefined && value !== "" && /^de/i.test(value) ? "de" : "en";
}

/** Printed to stderr, exit 2, when no key was resolved from either environment variable. */
export function noApiKeyMessage(lang: Lang = resolveLang(process.env)): string {
  return lang === "de"
    ? "Kein API-Key. Setze UNPII_API_KEY oder UNPII_API_KEY_FILE. " +
        "Keys erstellst du unter https://unpii.me/de/account/api-keys\n"
    : "No API key. Set UNPII_API_KEY or UNPII_API_KEY_FILE. " +
        "Create keys at https://unpii.me/en/account/api-keys\n";
}

/** Printed to stderr, exit 2, when the result is a document (base64 bytes in the response) and
 * no `--out` was given — dumping binary to a terminal is user-hostile, so the tool refuses
 * instead. `--json` bypasses this: the caller explicitly asked for the JSON envelope. */
export function outRequiredForDocumentMessage(lang: Lang = resolveLang(process.env)): string {
  return lang === "de"
    ? "Das Ergebnis ist eine Datei. Gib --out <pfad> an, um sie zu speichern.\n"
    : "The result is a file. Pass --out <path> to save it.\n";
}

/**
 * One sentence per API error code, keyed on `error.code` from the server — never on the
 * response body's `message`, and never on the caller's input. Codes are the exact set the
 * server's `/anonymize` and `/anonymize-file` routes emit (verified by reading the server
 * source, 2026-09-07). An unmapped or absent code falls back to
 * `unknownErrorMessage` below, which names only the HTTP status.
 *
 * Both languages carry EXACTLY the same key set (checked by `messages.test.ts`'s key-set
 * invariant, comparing `Object.keys(API_ERROR_MESSAGES.de).sort()` against the `en` side): a
 * code present in one language and missing in the other would silently fall back to the generic
 * "unknown error" sentence in that language, and nobody would notice.
 *
 * Exported (not just used internally) so a test can iterate every key and assert each sentence
 * is non-empty, distinct within its language, and free of both `{` and any body text.
 */
export const API_ERROR_MESSAGES: Record<Lang, Record<string, string>> = {
  de: {
    account_tier_required: "Dieser API-Key braucht einen bezahlten Tarif.",
    tier_required: "Diese Option braucht einen hoeheren Tarif.",
    rate_limited_burst: "Zu viele Anfragen in kurzer Zeit. Kurz warten und erneut versuchen.",
    daily_budget_exceeded: "Tageslimit erreicht.",
    char_limit_exceeded: "Text ist laenger als auf deinem Tarif erlaubt.",
    busy: "Der Dienst ist gerade ausgelastet. Bitte gleich erneut versuchen.",
    turnstile_required: "Verifizierung erforderlich. Anonyme Anfragen brauchen einen API-Key.",
    invalid_file: "Datei ist keine gueltige .docx oder .pdf.",
    file_too_large: "Datei ist groesser als erlaubt.",
    too_many_pages: "PDF hat mehr Seiten als erlaubt.",
    encrypted_file: "Datei ist verschluesselt und kann nicht gelesen werden.",
    no_text_layer: "PDF enthaelt keine Textebene.",
    unsupported_output_format: "Dieses Ausgabeformat ist fuer diesen Dateityp nicht verfuegbar.",
    invalid_field: "Ungueltiger Feldwert in der Anfrage.",
    custom_rules_timeout: "Eigene Regeln haben das Zeitlimit ueberschritten.",
    processing_error: "Verarbeitung fehlgeschlagen.",
  },
  en: {
    account_tier_required: "This API key needs a paid plan.",
    tier_required: "This option needs a higher plan.",
    rate_limited_burst: "Too many requests in a short time. Wait a moment and try again.",
    daily_budget_exceeded: "Daily limit reached.",
    char_limit_exceeded: "Text is longer than your plan allows.",
    busy: "The service is currently under heavy load. Please try again shortly.",
    turnstile_required: "Verification required. Anonymous requests need an API key.",
    invalid_file: "File is not a valid .docx or .pdf.",
    file_too_large: "File is larger than allowed.",
    too_many_pages: "PDF has more pages than allowed.",
    encrypted_file: "File is encrypted and cannot be read.",
    no_text_layer: "PDF has no text layer.",
    unsupported_output_format: "This output format is not available for this file type.",
    invalid_field: "Invalid field value in the request.",
    custom_rules_timeout: "Custom rules exceeded the time limit.",
    processing_error: "Processing failed.",
  },
};

function unknownErrorMessage(status: number, lang: Lang): string {
  return lang === "de" ? `Unbekannter Fehler (HTTP ${status}).` : `Unknown error (HTTP ${status}).`;
}

/** The STATUS cell in `--scan`'s table (`run.ts`'s `renderScanTable`), per span: whether it fell
 * into `uncertainSpans` (a low-confidence span is signal, never silently dropped) or into
 * `spans` proper. Sits under the header row `scanTableHeaders` builds below — both are
 * translated together, so the column and its header never disagree on language. */
export function scanStatusLabel(uncertain: boolean, lang: Lang = resolveLang(process.env)): string {
  if (lang === "de") return uncertain ? "unsicher" : "sicher";
  return uncertain ? "uncertain" : "confirmed";
}

/** The six column headers of `--scan`'s table (`run.ts`'s `renderScanTable`). Translated for the
 * same reason every other CLI string in this file is: the STATUS cells underneath (see
 * `scanStatusLabel` above) are already translated, and a translated column under an
 * untranslated English header row is only half-finished — the same argument that moved the
 * messages in args.ts/run.ts/cli.ts into `{ de, en }` pairs applies here too. Four of the six
 * cells are identical in both languages on purpose: ID, START, SCORE, and STATUS are exactly
 * these words in German technical usage as well, not a missed translation. */
export function scanTableHeaders(lang: Lang = resolveLang(process.env)): string[] {
  return lang === "de"
    ? ["KATEGORIE", "ID", "START", "ENDE", "SCORE", "STATUS"]
    : ["CATEGORY", "ID", "START", "END", "SCORE", "STATUS"];
}

/** Printed to stderr, exit 1, when `--scan` hits a bare HTTP 404 on `/api/v1/scan` — the route
 * ships with a later server release, so an older deployment answers 404 for it. `Unbekannter
 * Fehler (HTTP 404).` names no reason a caller could act on; this names the actual one. */
export function scanNotAvailableMessage(lang: Lang = resolveLang(process.env)): string {
  return lang === "de"
    ? "Dieser Server bietet die Scan-Funktion (--scan) noch nicht an.\n"
    : "This server does not offer the scan feature (--scan) yet.\n";
}

/** Builds the one stderr sentence for a caught `UnpiiError`. Never touches `err.message` (that
 * itself is already code+status only, see errors.ts) nor any response body — only `err.code` and
 * `err.status`, which is exactly the shape this function accepts. */
export function apiErrorMessage(
  err: Pick<UnpiiError, "code" | "status">,
  lang: Lang = resolveLang(process.env),
): string {
  const sentence = err.code !== undefined ? API_ERROR_MESSAGES[lang][err.code] : undefined;
  return `${sentence ?? unknownErrorMessage(err.status, lang)}\n`;
}

/** One sentence naming the X-RateLimit-* headers, when the response carried them. */
export function rateLimitSentence(
  remaining: number,
  limit: number | undefined,
  resetInSeconds: number,
  lang: Lang = resolveLang(process.env),
): string {
  const budget = limit !== undefined ? `${remaining}/${limit}` : String(remaining);
  return lang === "de"
    ? `Rate-Limit: noch ${budget} Anfragen, Reset in ${resetInSeconds}s.\n`
    : `Rate limit: ${budget} requests left, resets in ${resetInSeconds}s.\n`;
}

/** The one-line restore summary on stderr — inserted / of those fuzzy / not found / unknown. */
export function restoreSummary(
  result: RestoreResult,
  lang: Lang = resolveLang(process.env),
): string {
  const total = result.exact + result.fuzzy;
  if (lang === "de") {
    const fuzzyPart = result.fuzzy > 0 ? `, ${result.fuzzy} davon unscharf` : "";
    const parts = [`${total} Marker eingesetzt${fuzzyPart}`];
    if (result.missing.length > 0) {
      parts.push(`nicht vorgekommen: ${result.missing.join(", ")}`);
    }
    if (result.unknown.length > 0) {
      parts.push(`unbekannt: ${result.unknown.join(", ")}`);
    }
    return `${parts.join(" - ")}\n`;
  }
  const fuzzyPart = result.fuzzy > 0 ? `, ${result.fuzzy} of those fuzzy` : "";
  const parts = [`${total} markers inserted${fuzzyPart}`];
  if (result.missing.length > 0) {
    parts.push(`not found: ${result.missing.join(", ")}`);
  }
  if (result.unknown.length > 0) {
    parts.push(`unknown: ${result.unknown.join(", ")}`);
  }
  return `${parts.join(" - ")}\n`;
}

const HELP_TEXT_DE = `unpii <datei> [optionen]
unpii [optionen] < eingabe
unpii restore --from <antwort.json> [antwort-datei]

Schickt Text oder eine .docx/.pdf an die unpii.me API und gibt das anonymisierte Ergebnis auf
stdout aus. Ohne Pfad wird stdin gelesen. Der Dateityp wird an der Endung UND an den ersten
Bytes erkannt; bei Widerspruch gewinnen die Bytes.

Optionen:
  --out <pfad>       Ergebnis in eine Datei schreiben statt nach stdout
  --scan             nur die gefundenen Spans als Tabelle, ohne den Text
  --json             die volle API-Antwort unveraendert ausgeben (fuer restore)
  --marker <format>  default | custom | xxxxx | blackbar
  --keep <a,b,...>   Kategorien kommagetrennt von der Schwaerzung ausnehmen
  --from <pfad>      (nur bei restore) eine gespeicherte --json-Antwort
  --help             diese Hilfe
  --version          Versionsnummer

Umgebungsvariablen:
  UNPII_API_KEY       API-Key
  UNPII_API_KEY_FILE  Datei mit dem API-Key (wird getrimmt gelesen)
  UNPII_BASE_URL      Basis-URL, Default https://unpii.me

Exit-Codes:
  0  Erfolg
  1  API- oder Laufzeitfehler
  2  Aufruffehler oder fehlender Key

Beispiele:
  cat prod.log | unpii > prod.anon.log
  unpii vertrag.docx --out vertrag.anon.docx
  unpii --scan notiz.txt
  unpii --json notiz.txt > result.json
  unpii restore --from result.json antwort.md > antwort.klartext.md
  unpii --marker xxxxx --keep DATE,URL notiz.txt

Der Vorgang schreibt nie eine Datei, die nicht ueber --out bestellt wurde, und loggt nie den
Eingabetext.
`;

const HELP_TEXT_EN = `unpii <file> [options]
unpii [options] < input
unpii restore --from <response.json> [answer-file]

Sends text or a .docx/.pdf to the unpii.me API and prints the anonymized result to stdout.
Without a path, stdin is read. The file type is detected from BOTH the extension AND the first
bytes; on conflict, the bytes win.

Options:
  --out <path>       write the result to a file instead of stdout
  --scan             only the found spans as a table, without the text
  --json             print the full API response unchanged (for restore)
  --marker <format>  default | custom | xxxxx | blackbar
  --keep <a,b,...>   comma-separated categories to exclude from redaction
  --from <path>      (restore only) a saved --json response
  --help             this help
  --version          version number

Environment variables:
  UNPII_API_KEY       API key
  UNPII_API_KEY_FILE  file containing the API key (read trimmed)
  UNPII_BASE_URL      base URL, default https://unpii.me

Exit codes:
  0  success
  1  API or runtime error
  2  usage error or missing key

Examples:
  cat prod.log | unpii > prod.anon.log
  unpii contract.docx --out contract.anon.docx
  unpii --scan note.txt
  unpii --json note.txt > result.json
  unpii restore --from result.json answer.md > answer.plain.md
  unpii --marker xxxxx --keep DATE,URL note.txt

The tool never writes a file that wasn't requested via --out, and never logs the input text.
`;

export function helpText(lang: Lang = resolveLang(process.env)): string {
  return lang === "de" ? HELP_TEXT_DE : HELP_TEXT_EN;
}

// --- The rest of the same bilingual-output decision: these used to live inline at
// their throw/write sites in args.ts, run.ts, and cli.ts. In every function below, an
// interpolated `${...}` value is never translated — it is Node's own `node:util.parseArgs` error
// text, an OS filesystem/stream error message, or a CLI flag value the caller typed, never the
// text being anonymized ("Fehlermeldungen zitieren nie den Input" governs the request/response
// content, not argv). Only the sentence wrapped around the value is bilingual.

/** Thrown as `ArgsError` when `node:util`'s `parseArgs` itself rejects argv (unknown flag,
 * missing value, etc.). Deliberately does NOT end in "\n" — `cli.ts` appends it once when
 * printing `err.message`, so a function that also added one would double it. */
export function invalidArgumentsMessage(
  nodeMessage: string,
  lang: Lang = resolveLang(process.env),
): string {
  return lang === "de"
    ? `Ungueltige Argumente: ${nodeMessage}`
    : `Invalid arguments: ${nodeMessage}`;
}

/** Thrown as `ArgsError` when more than one positional path was given. No trailing "\n" — same
 * reason as `invalidArgumentsMessage`. */
export function tooManyPathsMessage(lang: Lang = resolveLang(process.env)): string {
  return lang === "de" ? "Nur ein Pfad ist erlaubt." : "Only one path is allowed.";
}

/** Thrown as `ArgsError` by `parseArgs` when `restore` was given without `--from`, and written
 * directly to stderr by `run.ts`'s defensive fallback for the same condition (normally
 * unreachable — args.ts already guards it; see the comment at that call site). No trailing "\n"
 * — the `parseArgs` call site relies on `cli.ts` to add it, and the `run.ts` call site adds its
 * own. */
export function restoreNeedsFromMessage(lang: Lang = resolveLang(process.env)): string {
  return lang === "de" ? "restore braucht --from <pfad>." : "restore needs --from <path>.";
}

/** Thrown as `ArgsError` when `--marker` doesn't match one of `MARKER_FORMATS`. `value` and
 * `allowed` are the caller's own flag value and the allowed-list text — CLI argv, not
 * anonymization input. No trailing "\n" — same reason as `invalidArgumentsMessage`. */
export function invalidMarkerMessage(
  value: string,
  allowed: string,
  lang: Lang = resolveLang(process.env),
): string {
  return lang === "de"
    ? `Ungueltiges --marker: ${value}. Erlaubt: ${allowed}.`
    : `Invalid --marker: ${value}. Allowed: ${allowed}.`;
}

/** Inner detail text for `fromReadFailedMessage` below, when the `--from` file parsed as JSON
 * but had no `spans` array. Static — carries none of the file's own content, so it is safe to
 * nest inside `fromReadFailedMessage`'s `detail` parameter. */
export function missingSpansArrayMessage(lang: Lang = resolveLang(process.env)): string {
  return lang === "de"
    ? "Datei enthaelt kein 'spans'-Array."
    : "File does not contain a 'spans' array.";
}

/** Inner detail text for `fromReadFailedMessage` below, when the `--from` file isn't valid JSON
 * at all. Deliberately static rather than forwarding `JSON.parse`'s own error message: that
 * message can quote a fragment of the parsed text (measured on Node 24 — `JSON.parse("not json
 * at all, ...")` throws `Unexpected token 'o', "not json at"... is not valid JSON`), and a
 * `--from` file holds spans carrying their `original` PII values, so a forwarded fragment could
 * itself be PII. `run.ts` therefore never passes a caught `JSON.parse` error's `.message` through
 * — it always substitutes this static sentence instead. */
export function invalidJsonMessage(lang: Lang = resolveLang(process.env)): string {
  return lang === "de"
    ? "Datei enthaelt kein gueltiges JSON."
    : "File does not contain valid JSON.";
}

/** Printed to stderr, exit 1, when the `--from` file couldn't be read or parsed. `detail` is
 * either an OS filesystem error message (safe — describes a path, never file content) or one of
 * `missingSpansArrayMessage`/`invalidJsonMessage` above (also safe) — never a raw `JSON.parse`
 * message, per `invalidJsonMessage`'s doc comment. */
export function fromReadFailedMessage(
  detail: string,
  lang: Lang = resolveLang(process.env),
): string {
  return lang === "de"
    ? `--from konnte nicht gelesen werden: ${detail}\n`
    : `--from could not be read: ${detail}\n`;
}

/** Printed to stderr, exit 1, when the restore answer (positional path or stdin) couldn't be
 * read. `detail` is always an OS filesystem/stream error message: this path never parses JSON,
 * so — unlike `fromReadFailedMessage` — there is no `JSON.parse`-quoting risk to guard against
 * here. */
export function answerReadFailedMessage(
  detail: string,
  lang: Lang = resolveLang(process.env),
): string {
  return lang === "de"
    ? `Antwort konnte nicht gelesen werden: ${detail}\n`
    : `Answer could not be read: ${detail}\n`;
}

/** Printed to stderr, exit 1, when the main command's input (positional path or stdin) couldn't
 * be read. `detail` is always an OS filesystem/stream error message — same reasoning as
 * `answerReadFailedMessage`: no JSON parsing happens on this path either. */
export function inputReadFailedMessage(
  detail: string,
  lang: Lang = resolveLang(process.env),
): string {
  return lang === "de"
    ? `Eingabe konnte nicht gelesen werden: ${detail}\n`
    : `Input could not be read: ${detail}\n`;
}

/** Printed to stderr, exit 1, when the API response body wasn't valid JSON. The SDK's
 * `res.json()` (undici) throws a `SyntaxError` for this, and — exactly like the local
 * `JSON.parse` case above — that error's own message can quote a fragment of the body (measured
 * against a real undici `fetch`: same `Unexpected token ...` shape). A `--json` response's spans
 * carry their `original` PII values, so `run.ts` intercepts `SyntaxError` specifically and uses
 * this static sentence instead of the caught error's `.message`. */
export function invalidResponseMessage(lang: Lang = resolveLang(process.env)): string {
  return lang === "de" ? "Antwort war kein gueltiges JSON.\n" : "Response was not valid JSON.\n";
}

/** Printed to stderr, exit 1, for any other error `runMain` didn't anticipate (not a
 * `UnpiiError`, not the `SyntaxError` case `invalidResponseMessage` covers). `detail` is that
 * error's own `.message` — always our own code's, Node's, or the SDK's own error text, never
 * request or response content, since the one path that could carry response content is
 * intercepted before reaching here. */
export function genericErrorMessage(detail: string, lang: Lang = resolveLang(process.env)): string {
  return lang === "de" ? `Fehler: ${detail}\n` : `Error: ${detail}\n`;
}

/** Printed to stderr, exit 1, by `cli.ts`'s last-resort catch-all — anything `parseArgs`/`runCli`
 * didn't already handle. Carries the same `SyntaxError` carve-out as `genericErrorMessage`/
 * `invalidResponseMessage` at its call site: defense in depth, since nothing below `main()`
 * should let a raw JSON-parse error reach this far, but if one ever does, its message must not
 * be forwarded either. */
export function unexpectedErrorMessage(
  detail: string,
  lang: Lang = resolveLang(process.env),
): string {
  return lang === "de" ? `Unerwarteter Fehler: ${detail}\n` : `Unexpected error: ${detail}\n`;
}
