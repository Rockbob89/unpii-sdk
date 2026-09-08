# Contract

`openapi.json` in this directory is a **reduced extract** of the production API's own OpenAPI
document — not a spec anyone wrote by hand, and, since 2026-09-08, not the full document either.
It carries only the five schemas and three paths this SDK actually calls; see "Why this file is
reduced" below for the rule and the reason. It is the source
`packages/sdk/scripts/gen-types.ts` reads to produce `packages/sdk/src/types.generated.ts`.

## Provenance

Originally fetched 2026-09-07 with the command below — **historical**, shown for the record of
where the underlying capture came from; it produces the FULL private contract and is missing the
reduce step, so do not run it as-is. "Renewing the snapshot" below has the current recipe.

```sh
curl -sS -o /tmp/openapi-raw.json "https://unpii.me/api/v1/openapi.json"
python3 -m json.tool --indent 2 /tmp/openapi-raw.json contract/openapi.json
pnpm format   # biome reformats it; biome's formatting is canonical, not json.tool's
```

The server's own response headers on that date: `last-modified: Mon, 07 Sep 2026 08:40:24 GMT`,
served by Caddy over HTTP/2, `content-type: application/json; charset=utf-8`. That fetch produced
the full private contract (26 schemas, 21 paths); reduced to the five schemas and three paths
below on 2026-09-08, after the same underlying capture — this repo has never checked in the full
document from a fetch newer than 2026-09-07.

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

## Why this file is reduced

The production document carries 26 schemas and 21 paths: five schemas and three paths (`POST
/api/v1/anonymize`, `POST /api/v1/anonymize-file`, `GET /api/v1/limits`) this SDK's public
surface is built from, and everything else — billing, allowlist, api-keys, admin, auth,
cancellation, the GDPR export at `/users/me/export`, an `isAdmin` flag on `UserPublic` — belongs
to the private web/API surface and has nothing to do with a published client SDK.

**This is not a secrecy measure — `https://unpii.me/api/v1/openapi.json` answers the full
document unauthenticated, and still does.** Nothing about this reduction withholds information
from that endpoint or from anyone who queries it directly. What it avoids is different: a public
repo's git history is effectively permanent the moment anyone forks or clones it, and a
searchable, versioned copy of the private surface sitting in that history is a different kind of
exposure than a JSON response nobody has a reason to specifically query — found and fixed in
review, 2026-09-08, before this repo had ever been published. So `contract/openapi.json` itself
carries only the five schemas and three paths below — not the full document with the rest merely
filtered out downstream.

`REQUIRED_SCHEMA_NAMES` and `REQUIRED_PATHS` in `packages/sdk/scripts/gen-types.ts` are the
single, exported list this rule lives as — both the script that produces this file
(`reduce-contract-snapshot.ts`, run via `pnpm --filter @unpii/sdk reduce:contract`) and the type
generator (`gen-types.ts`'s own `reduceDocument`) read the same two constants, rather than each
carrying its own copy that could drift from the other. `packages/sdk/test/contract-live.test.ts`
imports `REQUIRED_SCHEMA_NAMES` for the same reason, instead of maintaining a third copy:

- `AnonymizeRequest`
- `AnonymizeResponse`
- `AnonymizeFileResponse`
- `AnonymizeFileTextResponse`
- `LimitsResponse`

Running `openapiTS()` over the *full* document instead of this already-reduced file would still
emit roughly 2000 lines and leak the entire private API shape (billing requests, admin fields,
...) into the published `.d.ts` — `gen-types.ts`'s own `reduceDocument` step still exists and
still throws by name if any of the five is missing, as a second, independent guard, not because
it is still doing the primary reduction. That work now happens once, when the snapshot is
refreshed, not on every `gen:types` run.

`Span`, `AnonymizeStats` and `FileWarning` are **not** top-level schemas in this contract — the
server inlines their shape directly into `AnonymizeResponse.spans`, `.stats`,
`AnonymizeFileResponse.warnings`, etc. `types.generated.ts` derives all nine public SDK type
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
pnpm --filter @unpii/sdk reduce:contract /tmp/openapi-raw.json
pnpm format
pnpm --filter @unpii/sdk gen:types
pnpm verify
```

**The reduce step is not optional, and its position matters: before `pnpm format`, before
anything else touches `contract/openapi.json`.** The raw fetch is the full private contract; the
one place it may legitimately exist is `/tmp`, never a path `git add` can reach. `reduce:contract`
(`packages/sdk/scripts/reduce-contract-snapshot.ts`) reads the fetched file, keeps exactly
`REQUIRED_SCHEMA_NAMES`/`REQUIRED_PATHS` from `gen-types.ts`, and writes the result straight to
`contract/openapi.json` — there is no intermediate state where the full document sits at that
path waiting for a later step to shrink it.

`test/gen-types.test.ts` fails if the checked-in `types.generated.ts` no longer matches what the
generator produces from the (possibly updated) snapshot — that failure is the reminder to run
`gen:types` before committing. A live check against the running server also exists
(`packages/sdk/test/contract-live.test.ts`, skipped unless `UNPII_CONTRACT_LIVE=1` is set) and
tells you when the checked-in snapshot itself has drifted from production, which `gen-types.test.ts`
alone cannot: that test only ever compares the generator against whatever snapshot is on disk.
Both of that live test's checks reduce the live-fetched document with the same
`reduceContractSnapshot` before comparing — a raw whole-document diff against a reduced snapshot
would report drift on every single run, from the surface this repo no longer carries at all, not
from anything that actually changed.
