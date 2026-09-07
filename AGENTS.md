# unpii clients - charter

Three open-source clients for the [unpii.me](https://unpii.me) API: the TypeScript SDK
(`@unpii/sdk`, `packages/sdk`), the CLI (`unpii`, `packages/cli`), and the Python client
(`unpii-sdk` on PyPI, import name `unpii`, `python/`).

## 1. What these clients see, and what follows from it

Every one of these clients passes the caller's own text - possibly personal data - to the
server, either as the request body or by reading a file from disk. That has consequences that
apply to any change here, not just the obvious ones:

- Never log request input. Not the text, not a file's bytes, not a decoded response body.
- Never write a file nobody asked for. The CLI writes output only when `--out` was given; the
  SDKs never touch disk on their own.
- Error messages never quote the input. An error is built from the HTTP status and a validated
  `code`, never from the response body's message string and never from anything the caller
  passed in - because an error message is exactly what ends up in a log, an issue tracker, or a
  screenshot.

## 2. Zero runtime dependencies, enforced by test

Each package's dependency count is a promise a test checks, not just a README line:

- `@unpii/sdk` has zero runtime dependencies - Node's own `fetch`/`FormData`/`Blob` are enough.
  Enforced by the `package.json` describe block in `packages/sdk/test/package-shape.test.ts`.
- `unpii` (the CLI) has exactly one dependency: its own sibling `@unpii/sdk`, pinned to
  `workspace:*`. Enforced by the `package.json` describe block in `packages/cli/test/cli.test.ts`.
- The Python client has zero runtime dependencies - stdlib `urllib`/`json`/`mimetypes`/`uuid`
  only. Enforced by `test_pyproject_has_no_runtime_dependencies` in `python/tests/test_client.py`,
  which reads `pyproject.toml`'s `dependencies` list directly.

A dependency promise without a guard is a claim, not a fact - if you touch a package's
`dependencies`/`pyproject.toml`, the corresponding test is what actually holds you to this.

## 3. Fixtures are captures, not fiction

Every `.json` under `fixtures/` is an unedited response from the real server, with its own
provenance line - see `fixtures/README.md`. A hand-written stub that merely looks like a server
response is exactly the failure mode this guards against: it can look correct and still be
wrong in a way nothing catches. Replacing a fixture means recapturing it, not editing the JSON
by hand.

## 4. Commits carry no attribution

Commit messages are short and describe the change and its reason. No co-authorship trailers, no
tool or session attribution, no generated-by boilerplate - the commit is the work.

## 5. Anonymized output is returned and discarded

The server returns the anonymized result to the caller and keeps nothing. These clients hold up
their end of that by never persisting a response on their own: no cache, no temp file, no
implicit write. What the caller does with the result after it comes back is the caller's
decision, not this code's.

## 6. Two measured gotchas, easy to reintroduce

**`JSON.parse` error messages must never reach the user.** V8 quotes up to ten characters of the
input when it doesn't start with valid JSON - measured on Node 24:
`JSON.parse("Anne Schmi...")` throws `Unexpected token 'A', "Anne Schmi"... is not valid JSON`.
Both the CLI's `--from` file and an API response body can carry `original` PII values at exactly
that point, so a forwarded `JSON.parse`/`SyntaxError` message is a potential PII leak through an
error string. The CLI catches `SyntaxError` at both sites and substitutes a fixed sentence
instead of the caught message - see `invalidJsonMessage` and `invalidResponseMessage` in
`packages/cli/src/messages.ts`. Anyone touching either call site has to preserve that substitution,
not just the try/catch.

**CLI messages are bilingual, English by default.** Every user-facing CLI string lives in
`packages/cli/src/messages.ts` as a `{ de, en }` pair, resolved via `LANG`/`LC_ALL`
(`resolveLang`). `messages.test.ts` asserts the German and English key sets are identical for
`API_ERROR_MESSAGES` and that every message function produces two distinct, non-empty strings.
A new message needs both languages from the start, or that invariant goes red.
