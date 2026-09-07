# SDK-Fixtures - Herkunft

Jede `.json` in diesem Verzeichnis ist eine **unveraenderte Antwort des echten Servers**,
aufgenommen am **2026-09-07** gegen eine Entwicklungsinstanz der API. Nichts hier ist
handgeschrieben. Die einzige nachtraegliche Aenderung ist Biomes JSON-Formatierung
(Einrueckung, Zeilenumbrueche), damit `pnpm lint` ohne Ausnahmeregel gruen bleibt -
Schluesselreihenfolge, Werte und Gleitkomma-Genauigkeit sind die des Servers.

Welche Modellversion die Spans erzeugt hat, steht in den Aufzeichnungen des Hauptrepos, das die
API baut, und nicht hier: welches Modell hinter der API laeuft, ist keine Zusage an den Aufrufer
und aendert sich, ohne dass der Vertrag sich aendert.

Der Grund fuer diese Strenge ist teuer bezahlt: ein handgeschriebener Stub hat schon einmal
einen Integrationsfehler bis in die Produktion gruen durchgewinkt. Ein Fixture ist ein Beleg oder es
ist nichts. Wer eine Datei ersetzt, nimmt sie neu auf - er editiert sie nicht.

Eingabetext aller Text-Aufnahmen ist der Sample-Text der Weboberflaeche (der i18n-String
`redact.input.sample`). Die Datei-Aufnahme benutzt eine formatierte .docx-Testdatei aus dem
Hauptrepo, das die API baut - dort Teil von dessen eigenen Test-Fixtures.

| Datei | Aufruf | Aufrufer | Status |
|---|---|---|---|
| `anonymize.docs.json` | `POST /api/v1/anonymize`, `{text, markerFormat:"default", ambiguous:"redact"}` | API-Key, Tier `docs` | 200 |
| `anonymize.anon.json` | `POST /api/v1/anonymize`, `{text}` | ohne Auth (anonym) | 200 |
| `anonymize-file.docx.json` | `POST /api/v1/anonymize-file`, Multipart `markerFormat` + `file` | API-Key, Tier `docs` | 200 |
| `error.tier-required.json` | `POST /api/v1/anonymize`, `markerFormat:"default"` | ohne Auth (anonym) | 402 `tier_required` |
| `error.account-tier-required.json` | `POST /api/v1/anonymize` | API-Key, Tier `free` | 402 `account_tier_required` |
| `error.route-not-found.json` | `POST /api/v1/scan` | API-Key, Tier `docs` | 404 (Route gibt es heute nicht) |

Die 404-Aufnahme ist die wichtigste der drei Fehleraufnahmen, weil sie eine ANDERE Huelle hat:
Fastifys Standardfehler ist `{message, error, statusCode}` - `error` ist dort ein **String**,
waehrend unsere eigenen Fehler `{error: {code, message, ...}}` liefern. Ein Fehlerparser, der
`body.error.code` blind liest, stirbt an dieser Antwort. Deshalb liegt sie hier.

Was die zwei Erfolgsaufnahmen unterscheiden, ist nicht nur der Tier: anonym liefert der Server
maskierte Marker (`xxxxx`) und die Kategorie `REDACTED` statt der echten Kategorie. Die SDK muss
beide Formen unfallfrei durchreichen, deshalb liegen beide hier.

## Was hier NICHT liegt

Fuer `POST /api/v1/scan` gibt es keine Aufnahme, weil es die Route auf dem Server, gegen den
aufgenommen wurde, noch nicht gibt. `Unpii.scan()` ist gegen den in diesem Repo hand-typisierten
Vertrag gebaut (`packages/sdk/src/types.ts`s `ScanResponse`, siehe dessen Kommentar) und wird im
Test gegen einen Stub gefahren, der aus `anonymize.docs.json` abgeleitet ist. Sobald `/scan` auf
dem Server steht, gehoert hier eine echte Aufnahme her - und der abgeleitete Stub verschwindet.

## Neu aufnehmen

Im Hauptrepo, das die API baut, lokal starten, einen API-Key auf dem gewuenschten Tarif erzeugen
(an der Weboberflaeche unter `/de/account/api-keys`) und exakt den in der Tabelle oben genannten
Aufruf gegen die laufende Dev-API fahren - Ergebnis roh in die passende Datei hier schreiben.
Danach `pnpm format`: Biome reformatiert (Einrueckung, Zeilenumbrueche), damit `pnpm lint` hier
gruen bleibt, ohne Schluesselreihenfolge oder Werte anzufassen.

Der Key gehoert nicht in diese Datei, nicht in einen Commit und nicht in eine Fehlermeldung.
