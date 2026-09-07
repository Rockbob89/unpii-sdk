# @unpii/sdk

TypeScript client for [unpii](https://unpii.me) - send text, get it back with the personal data
replaced by markers.

```bash
npm i @unpii/sdk
```

Three lines to your first redaction:

```ts
import { Unpii } from "@unpii/sdk";

const unpii = new Unpii({ apiKey: process.env.UNPII_API_KEY! });
const res = await unpii.anonymize("Hallo Anne Schmitz, Termin am 15.03.2026");

console.log(res.anonymized); // Hallo [PERSON_1], Termin am [DATE_1]
```

## Where the key comes from

You need an API key, and API keys come with a paid plan. Create one at
<https://unpii.me/de/account/api-keys>.

Keep it in the environment, not in your code and not on a command line:

```bash
export UNPII_API_KEY=ak_...
```

The SDK itself reads **no** environment variables - you pass the key in. That is deliberate: a
library that reaches into `process.env` behind your back is a library you cannot test.

## Translating back

The response carries the original text of every span, so putting the names back into an answer
you got from an LLM is a pure function over data you already hold. No second request, no round
trip, nothing leaves your process:

```ts
import { Unpii, restore } from "@unpii/sdk";

const res = await unpii.anonymize(email);
const answer = await yourLlm(res.anonymized);
const back = restore(answer, res.spans);

console.log(back.text);
console.log(`${back.exact + back.fuzzy} markers replaced, ${back.fuzzy} of them loosely`);
```

`restore` is tolerant on purpose, because language models rewrite markers. `[PERSON_1]`,
`PERSON_1`, `Person 1` and `person-1` all find their way home; `PERSON_1` never matches inside
`PERSON_12`. What it could not place it reports rather than hides:

| field | meaning |
|---|---|
| `text` | the answer with every marker it could place replaced |
| `exact` | markers that appeared exactly as we wrote them, `[LABEL_n]` |
| `fuzzy` | markers it recognised in a rewritten form |
| `missing` | markers from your result that never appeared in the answer |
| `unknown` | marker-shaped strings in the answer that belong to nothing we sent |

A non-empty `unknown` usually means the model invented a marker. That is worth looking at.

## API

```ts
new Unpii({ apiKey, baseUrl?, fetch? })
```

`baseUrl` defaults to `https://unpii.me`. `fetch` lets you inject your own implementation,
which is how the test suite runs without a network.

- `anonymize(text, { markerFormat?, ambiguous?, keep?, structure? })` - text in, `anonymized`
  plus `spans` and `uncertainSpans` out.
- `scan(text)` - the spans without the redacted text. **Not available yet**: the route ships
  with a later release and today's server answers 404.
- `anonymizeFile(bytes, { filename, markerFormat?, outputFormat?, redactUncertain? })` - a
  `.docx` or `.pdf` in, a freshly generated document out (or plain text for a PDF, with
  `outputFormat: "text"`). The original file is never edited - it is rebuilt, which is the only
  way a redaction is structural rather than a list of places someone had to remember.
- `limits()` - your plan's daily limits and what the other plans allow.

`keep` and `structure` are accepted by the SDK today and are honoured by a later server release;
the current server ignores fields it does not know, so passing them costs nothing.

## Errors

Any non-2xx response throws `UnpiiError`:

```ts
class UnpiiError extends Error {
  status: number;            // HTTP status
  code: string | undefined;  // e.g. "tier_required"
  requestId: string | undefined;
}
```

**The message never contains the response body and never contains your input.** It is built from
the code and the status, nothing else. That is not politeness: an error message ends up in logs,
in issue trackers and in screenshots, and this SDK exists to keep personal data out of exactly
those places.

## What this package does not do

No runtime dependencies - Node 22 already has `fetch`, `FormData` and `Blob`. Check the
`dependencies` field; it is empty, and a test keeps it that way.

No validation of responses either. The SDK checks `response.ok` and hands you the parsed JSON.
A server that adds a field must not break a client that has not been updated, and shipping a
schema validator would make that a lie. The types are generated from the server's own schema
rather than transcribed, so they cannot quietly drift from it.

Requires Node 22 or newer.

## Licence

Apache-2.0
