# SDK-Fixtures - Herkunft

Jede `.json` in diesem Verzeichnis ist eine **unveraenderte Antwort des echten Servers**,
aufgenommen am **2026-09-07** gegen die lokale Dev-API (`pnpm dev`, api auf `:3001`), die ihre
Inferenz beim GPU-Host bezog. Modell laut `/healthz` der Inferenz:
`Bobbydarocketbob/unpii-privacy-filter-laufA`. Nichts hier ist handgeschrieben. Die einzige
nachtraegliche Aenderung ist Biomes JSON-Formatierung (Einrueckung, Zeilenumbrueche), damit
`pnpm lint` ohne Ausnahmeregel gruen bleibt - Schluesselreihenfolge, Werte und
Gleitkomma-Genauigkeit sind die des Servers.

Der Grund steht in der Charter (§6, Billing): ein handgeschriebener Stub hat schon einmal einen
Integrationsfehler bis in die Produktion gruen durchgewinkt. Ein Fixture ist ein Beleg oder es
ist nichts. Wer eine Datei ersetzt, nimmt sie neu auf - er editiert sie nicht.

Eingabetext aller Text-Aufnahmen ist der Sample-Text der Weboberflaeche
(`redact.input.sample`, `apps/web/src/i18n/de.json`). Die Datei-Aufnahme benutzt
`apps/api/src/test-fixtures/formatted-lo.docx`.

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

Fuer `POST /api/v1/scan` gibt es keine Aufnahme, weil es die Route heute nicht gibt - sie kommt
aus Session 03 (`docs/superpowers/plans/2026-09-07-launch-03-api-antwort.md`). `Unpii.scan()`
ist gegen den dort festgelegten Vertrag gebaut und wird im Test gegen einen Stub gefahren, der
aus `anonymize.docs.json` abgeleitet ist. Sobald `/scan` steht, gehoert hier eine echte
Aufnahme her - und der abgeleitete Stub verschwindet.

## Neu aufnehmen

```bash
pnpm dev                                  # api :3001, Inferenz remote laut env/dev/api.env
pnpm dev:tier:docs                        # Dev-Nutzer auf Docs
# Key: an der Weboberflaeche unter /de/account/api-keys, oder
#   POST /api/v1/api-keys mit einer Session (Body {"name":"..."} ) - der Klartext-Key
#   kommt genau einmal zurueck.
curl -s -X POST http://localhost:3001/api/v1/anonymize \
  -H "Authorization: Bearer $UNPII_API_KEY" -H "Content-Type: application/json" \
  --data-binary @request.json -o anonymize.docs.json
```

Der Key gehoert nicht in diese Datei, nicht in einen Commit und nicht in eine Fehlermeldung.
