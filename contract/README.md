# Contract

`openapi.json` in this directory is a snapshot of the production API's own OpenAPI document —
not a spec anyone wrote by hand. It is the source `packages/sdk/scripts/gen-types.ts` reads to
produce `packages/sdk/src/types.generated.ts`.

## Provenance

Fetched 2026-09-07 with:

```sh
curl -sS -o /tmp/openapi-raw.json "https://unpii.me/api/v1/openapi.json"
python3 -m json.tool --indent 2 /tmp/openapi-raw.json contract/openapi.json
pnpm format   # biome reformats it; biome's formatting is canonical, not json.tool's
```

The server's own response headers on that date: `last-modified: Mon, 07 Sep 2026 08:40:24 GMT`,
served by Caddy over HTTP/2, `content-type: application/json; charset=utf-8`.

**`https://unpii.me/openapi.json` (no `/api/v1/` prefix) is a trap, not a shortcut.** It answers
`200 text/html` with the web app's SPA shell — measured the same day, same `curl`, headers
included `content-type: text/html; charset=utf-8`, `content-length: 2396`. The real document sits
behind the API's `handle /api/*` block at `https://unpii.me/api/v1/openapi.json`. Fetching the
trap URL and not noticing the content-type would silently write HTML into this file.

## Base URL: `https://unpii.me`, not what `servers` says

The snapshot's own `servers` array is `[{"url": "https://anonymize.example", "description":
"production (placeholder)"}, {"url": "http://localhost:3001", "description": "local dev"}]` — a
placeholder the server has never had corrected. It is **not** what the SDK, CLI or Python client
use as their default base URL. All three default to `https://unpii.me`.

That works because every path in this document already carries the `/api/v1/` prefix (e.g.
`/api/v1/anonymize`) and the production API is reverse-proxied at `https://unpii.me` behind a
Caddy `handle /api/*` block — base URL plus path is the real, reachable address.

**`api.unpii.me` does not exist.** It resolves to NXDOMAIN (checked 2026-09-07 with `getent hosts
api.unpii.me`) and must never appear as a default or an example anywhere in this repo — a stale
value from the donor repo this SDK was transplanted from. If you find it, that is a bug; grep the
whole tree (`grep -rn "api\.unpii\.me"`, excluding `node_modules`, `dist`, `.venv`,
`pnpm-lock.yaml`) and fix every hit.

## What's in here, and what isn't

The document carries 25 schemas: five the SDK's public surface is built from, and twenty more —
billing, allowlist, api-keys, admin, auth, cancellation — that belong to the private web/API
surface and have nothing to do with a published client SDK. `gen-types.ts` reduces the document
to exactly these five before handing it to `openapiTS()`:

- `AnonymizeRequest`
- `AnonymizeResponse`
- `AnonymizeFileResponse`
- `AnonymizeFileTextResponse`
- `LimitsResponse`

Running `openapiTS()` over the *full* document instead emits roughly 2000 lines and would leak
the entire private API shape (billing requests, admin fields, ...) into the published `.d.ts`.
The reduction is enforced, not just a convention: `gen-types.ts` throws by name if any of the
five is missing from the source document, rather than silently generating fewer.

`Span`, `AnonymizeStats` and `FileWarning` are **not** top-level schemas in this contract — the
server inlines their shape directly into `AnonymizeResponse.spans`, `.stats`,
`AnonymizeFileResponse.warnings`, etc. `types.generated.ts` derives all eight public SDK type
names (three of which are these inline shapes) from the five schemas above by TypeScript index
access (`components["schemas"]["AnonymizeResponse"]["spans"][number]`, and so on) rather than by
naming them separately in the reduced document — see the comment on `ALIAS_BLOCK` in
`gen-types.ts` for why index access, not a hand-copied shape, is what makes this a real guard
against drift.

## `POST /api/v1/scan` is missing on purpose

That route does not exist on the server this snapshot was taken from — it is not in `paths`.
Because of that, `ScanResponse` cannot be derived and stays hand-typed in
`packages/sdk/src/types.ts`, ahead of the server shipping the route. When `/api/v1/scan` lands
and appears in a refreshed snapshot, `ScanResponse` should move into `gen-types.ts`'s derived set
like its siblings, and the hand-written interface in `types.ts` should be deleted.

## `LimitsResponse` used to be hand-typed too

Until this change, `LimitsResponse` was hand-mirrored in `types.ts` against the server's own
route, because at the time it wasn't considered one of the schemas worth deriving. The contract carries it now, the shape matches the hand-typed
version field-for-field (including the two legacy top-level groups `anonymize` and `auth`), so it
moved into the derived set. One thing was lost in that move and is not an accident: the
hand-typed version carried `@deprecated` JSDoc on `anonymize` and `auth`, pointing callers at
`reference.web`/`reference.api` and `burst.magic_link_per_hour` instead. A derived type has no
JSDoc to carry that annotation — the fields themselves are unchanged and the server still sends
them, only the deprecation note is gone from the type. If that distinction ever needs to reach
consumers of the SDK again, it has to be re-added by hand in `packages/sdk/src/index.ts` or the
README, not assumed to survive generation.

## `types.generated.ts` is excluded from Biome

`openapi-typescript` indents its output with 4 spaces; this repo's Biome config uses 2. Rather
than post-processing generated output to match a formatter (which would just be a second place
this file could drift from what the generator actually produced), `types.generated.ts` is listed
in `biome.json`'s `files.ignore` and is never formatted or linted. `biome.json` has no comment
syntax, which is why this reasoning lives here instead of next to that line.

## Renewing the snapshot

```sh
curl -sS -o /tmp/openapi-raw.json "https://unpii.me/api/v1/openapi.json"
python3 -m json.tool --indent 2 /tmp/openapi-raw.json contract/openapi.json
pnpm format
pnpm --filter @unpii/sdk gen:types
pnpm verify
```

`test/gen-types.test.ts` fails if the checked-in `types.generated.ts` no longer matches what the
generator produces from the (possibly updated) snapshot — that failure is the reminder to run
`gen:types` before committing. A live check against the running server also exists
(`packages/sdk/test/contract-live.test.ts`, skipped unless `UNPII_CONTRACT_LIVE=1` is set) and
tells you when the checked-in snapshot itself has drifted from production, which `gen-types.test.ts`
alone cannot: that test only ever compares the generator against whatever snapshot is on disk.
