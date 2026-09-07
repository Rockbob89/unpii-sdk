import type { RestoreResult, UnpiiError } from "@unpii/sdk";

/** Printed to stderr, exit 2, when no key was resolved from either environment variable. */
export function noApiKeyMessage(): string {
  return (
    "Kein API-Key. Setze UNPII_API_KEY oder UNPII_API_KEY_FILE. " +
    "Keys erstellst du unter https://unpii.me/de/account/api-keys\n"
  );
}

/** Printed to stderr, exit 2, when the result is a document (base64 bytes in the response) and
 * no `--out` was given — dumping binary to a terminal is user-hostile, so the tool refuses
 * instead. `--json` bypasses this: the caller explicitly asked for the JSON envelope. */
export function outRequiredForDocumentMessage(): string {
  return "Das Ergebnis ist eine Datei. Gib --out <pfad> an, um sie zu speichern.\n";
}

/**
 * One sentence per API error code, keyed on `error.code` from the server — never on the
 * response body's `message`, and never on the caller's input. Codes are the exact set emitted by
 * `apps/api/src/routes/anonymize.ts` and `apps/api/src/routes/anonymize-file.ts` (verified by
 * reading both files, 2026-09-07). An unmapped or absent code falls back to
 * `unknownErrorMessage` below, which names only the HTTP status.
 *
 * Exported (not just used internally) so a test can iterate every key and assert each sentence
 * is non-empty, distinct, and free of both `{` and any body text.
 */
export const API_ERROR_MESSAGES: Record<string, string> = {
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
};

function unknownErrorMessage(status: number): string {
  return `Unbekannter Fehler (HTTP ${status}).`;
}

/** Printed to stderr, exit 1, when `--scan` hits a bare HTTP 404 on `/api/v1/scan` — the route
 * ships with a later server release, so an older deployment answers 404 for it. `Unbekannter
 * Fehler (HTTP 404).` names no reason a caller could act on; this names the actual one. */
export function scanNotAvailableMessage(): string {
  return "Dieser Server bietet die Scan-Funktion (--scan) noch nicht an.\n";
}

/** Builds the one stderr sentence for a caught `UnpiiError`. Never touches `err.message` (that
 * itself is already code+status only, see errors.ts) nor any response body — only `err.code` and
 * `err.status`, which is exactly the shape this function accepts. */
export function apiErrorMessage(err: Pick<UnpiiError, "code" | "status">): string {
  const sentence = err.code !== undefined ? API_ERROR_MESSAGES[err.code] : undefined;
  return `${sentence ?? unknownErrorMessage(err.status)}\n`;
}

/** One sentence naming the X-RateLimit-* headers, when the response carried them. */
export function rateLimitSentence(
  remaining: number,
  limit: number | undefined,
  resetInSeconds: number,
): string {
  const budget = limit !== undefined ? `${remaining}/${limit}` : String(remaining);
  return `Rate-Limit: noch ${budget} Anfragen, Reset in ${resetInSeconds}s.\n`;
}

/** The one-line restore summary on stderr — inserted / of those fuzzy / not found / unknown. */
export function restoreSummary(result: RestoreResult): string {
  const total = result.exact + result.fuzzy;
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

export function helpText(): string {
  return `unpii <datei> [optionen]
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
  UNPII_BASE_URL      Basis-URL, Default https://api.unpii.me

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
}
