# unpii clients

The open-source clients for [unpii.me](https://unpii.me), a PII-redaction API: send text,
Markdown, or a `.docx`/`.pdf`, get it back with the personal data replaced by category-specific
markers. Three clients, one repo:

- **`@unpii/sdk`** - TypeScript SDK (`packages/sdk`)
- **`unpii`** - command-line tool (`packages/cli`)
- **`unpii-sdk`** on PyPI, import name `unpii` - Python client (`python/`)

Each has its own README with the full API; this page is the map between them.

## Three lines to your first redaction

TypeScript:

```ts
import { Unpii } from "@unpii/sdk";

const unpii = new Unpii({ apiKey: process.env.UNPII_API_KEY! });
const res = await unpii.anonymize("Hallo Anne Schmitz, Termin am 15.03.2026");

console.log(res.anonymized); // Hallo [PERSON_1], Termin am [DATE_1]
```

CLI:

```bash
cat prod.log | npx unpii > prod.anon.log
npx unpii vertrag.docx --out vertrag.anon.docx
```

Python:

```python
import os
from unpii import Client

res = Client(api_key=os.environ["UNPII_API_KEY"]).anonymize("Hallo Anne Schmitz, Termin am 15.03.2026")

print(res.anonymized)  # Hallo [PERSON_1], Termin am [DATE_1]
```

See `packages/sdk/README.md`, `packages/cli/README.md`, and `python/README.md` for the full API
of each - options, error handling, restoring markers back to their originals.

## Where the key comes from

Every call needs an API key, and API keys come with a paid plan. Create one at
[unpii.me/en/account/api-keys](https://unpii.me/en/account/api-keys).

Keep it in the environment, never in code and never on a command line - a key passed as an
argument lands in shell history and in `ps` output for every other process on the machine to see.

## What these clients write and log

**Nothing gets written that wasn't asked for, and nothing gets logged.** The CLI writes a file
only when `--out` is given; without it, the result goes to stdout and nothing else touches disk.
Neither SDK reads an environment variable on its own - the caller passes the key in, which is
also what keeps them testable. No client logs the text it sends or the response it gets back.

## CLI exit codes

```
0  success
1  API or runtime error
2  usage error or missing key
```

## More

- [`AGENTS.md`](AGENTS.md) - the charter this repo is held to: what these clients see, why
  dependencies are zero and test-enforced, and two gotchas worth knowing before touching error
  handling.
- [`contract/README.md`](contract/README.md) - where the TypeScript types come from and how the
  OpenAPI snapshot is kept honest.
- [`fixtures/README.md`](fixtures/README.md) - provenance of every captured server response the
  test suites read.

## Licence

Apache-2.0 - see [`LICENSE`](LICENSE).
