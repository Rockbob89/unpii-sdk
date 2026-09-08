# SDK fixtures - provenance

Every `.json` in this directory is an **unedited response from the real server**, captured on
**2026-09-07** against a development instance of the API. Nothing here is hand-written. The only
change made afterward is Biome's JSON formatting (indentation, line breaks) so that `pnpm lint`
stays green without an exception rule - key order, values and floating-point precision are the
server's own.

Which model version produced the spans is recorded in the private repo that builds the API, not
here: which model runs behind the API is not a promise to the caller and can change without the
contract changing.

The reason for this strictness was expensive to learn: a hand-written stub once waved an
integration bug all the way through to production, green the whole time. A fixture is either
evidence or it is nothing. Replacing a file means re-capturing it, not hand-editing the JSON.

The input text of every text capture is the web app's sample text (the i18n string
`redact.input.sample`). The file capture uses a formatted `.docx` test fixture from the private
repo that builds the API, where it is part of that repo's own test fixtures.

| File | Call | Caller | Status |
|---|---|---|---|
| `anonymize.docs.json` | `POST /api/v1/anonymize`, `{text, markerFormat:"default", ambiguous:"redact"}` | API key, tier `docs` | 200 |
| `anonymize.anon.json` | `POST /api/v1/anonymize`, `{text}` | no auth (anonymous) | 200 |
| `anonymize-file.docx.json` | `POST /api/v1/anonymize-file`, multipart `markerFormat` + `file` | API key, tier `docs` | 200 |
| `error.tier-required.json` | `POST /api/v1/anonymize`, `markerFormat:"default"` | no auth (anonymous) | 402 `tier_required` |
| `error.account-tier-required.json` | `POST /api/v1/anonymize` | API key, tier `free` | 402 `account_tier_required` |
| `error.route-not-found.json` | `POST /api/v1/scan` | API key, tier `docs` | 404 (route does not exist yet) |

The 404 capture is the most important of the three error captures, because it has a DIFFERENT
envelope: Fastify's default error is `{message, error, statusCode}` - `error` is a **string**
there, while our own errors return `{error: {code, message, ...}}`. An error parser that blindly
reads `body.error.code` dies on this response. That is why it is here.

What distinguishes the two success captures is not just the tier: the anonymous response masks
the markers (`xxxxx`) and uses the category `REDACTED` instead of the real category. The SDK has
to pass both forms through without incident, which is why both are here.

## What is NOT here

There is no capture for `POST /api/v1/scan`, because the route does not exist yet on the server
this was captured against. `Unpii.scan()` is built against the contract hand-typed in this repo
(`packages/sdk/src/types.ts`'s `ScanResponse`, see its comment) and is tested against a stub
derived from `anonymize.docs.json`. Once `/scan` ships on the server, a real capture belongs here
and the derived stub goes away.

## Re-capturing

Start the private repo that builds the API locally, mint an API key on the desired tier (via the
web app under `/de/account/api-keys`), and run exactly the call named in the table above against
the running dev API - write the raw result into the matching file here. Then run `pnpm format`:
Biome reformats it (indentation, line breaks) so `pnpm lint` stays green here, without touching
key order or values.

The key belongs in none of: this file, a commit, or an error message.
