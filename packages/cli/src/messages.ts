import type { RestoreResult, UnpiiError } from "@unpii/sdk";

/** The two output languages the CLI speaks. English is the default — the npm audience is
 * international — with German available via `LANG`/`LC_ALL` for the audience Plan 08 wrote the
 * original sentences for. */
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
 * response body's `message`, and never on the caller's input. Codes are the exact set emitted by
 * `apps/api/src/routes/anonymize.ts` and `apps/api/src/routes/anonymize-file.ts` (verified by
 * reading both files, 2026-09-07). An unmapped or absent code falls back to
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
