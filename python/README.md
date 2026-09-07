# unpii-sdk

Python client for [unpii](https://unpii.me) - send text, get it back with the personal data
replaced by markers.

The package on PyPI is `unpii-sdk`; the import name is `unpii`.

```bash
pip install unpii-sdk
```

Three lines to your first redaction:

```python
import os
from unpii import Client

res = Client(api_key=os.environ["UNPII_API_KEY"]).anonymize("Hallo Anne Schmitz, Termin am 15.03.2026")

print(res.anonymized)  # Hallo [PERSON_1], Termin am [DATE_1]
```

## Where the key comes from

You need an API key, and API keys come with a paid plan. Create one at
<https://unpii.me/de/account/api-keys>.

Keep it in the environment, not in your code and not on a command line:

```bash
export UNPII_API_KEY=ak_...
```

The client reads **no** environment variables itself - you pass the key in. A library that
reaches into `os.environ` behind your back is a library you cannot test.

## Translating back

The response carries the original text of every span, so putting the names back into an answer
from an LLM is a pure function over data you already hold. No second request, nothing leaves
your process:

```python
from unpii import Client, restore

res = Client(api_key=os.environ["UNPII_API_KEY"]).anonymize(email)
answer = your_llm(res.anonymized)
back = restore(answer, res.spans)

print(back.text)
print(f"{back.exact + back.fuzzy} markers replaced, {back.fuzzy} of them loosely")
```

`restore` is tolerant on purpose, because language models rewrite markers. `[PERSON_1]`,
`PERSON_1`, `Person 1` and `person-1` all find their way home; `PERSON_1` never matches inside
`PERSON_12`. What it could not place it reports rather than hides:

| field | meaning |
|---|---|
| `text` | the answer with every marker it could place replaced |
| `exact` | markers that appeared exactly as we wrote them, `[LABEL_n]` |
| `fuzzy` | markers recognised in a rewritten form |
| `missing` | markers from your result that never appeared in the answer |
| `unknown` | marker-shaped strings in the answer that belong to nothing we sent |

A non-empty `unknown` usually means the model invented a marker. That is worth looking at.

This function is the twin of the one in the TypeScript SDK, and not by hand-waving: both read the
same table of cases with the same expected results, so a change to one that the other does not
follow turns a test red.

## API

```python
Client(api_key, base_url="https://unpii.me", timeout=120.0)
```

- `anonymize(text, *, marker_format=None, ambiguous=None, keep=None, structure=None)` - text in,
  `anonymized` plus `spans` and `uncertain_spans` out.
- `scan(text)` - the spans without the redacted text. **Not available yet**: the route ships with
  a later release and today's server answers 404.
- `anonymize_file(data, *, filename, marker_format=None, output_format=None,
  redact_uncertain=None)` - a `.docx` or `.pdf` in, a freshly generated document out (or plain
  text for a PDF, with `output_format="text"`). The original file is never edited - it is
  rebuilt, which is the only way a redaction is structural rather than a list of places someone
  had to remember.
- `limits()` - your plan's daily limits and what the other plans allow.

`keep` and `structure` are accepted today and honoured by a later server release; the current
server ignores fields it does not know, so passing them costs nothing.

Wire fields are camelCase, Python names are snake_case; the mapping happens in one place, and
unknown fields are ignored rather than fatal.

## Errors

Any non-2xx response raises `UnpiiError` with `status`, `code` and `request_id`. So does a
connection failure, so `except UnpiiError` really is enough.

**The message never contains the response body and never contains your input.** It is built from
the code and the status, nothing else. That is not politeness: an error message ends up in logs,
in issue trackers and in screenshots, and this package exists to keep personal data out of
exactly those places.

## What this package does not do

No dependencies. Not `requests`, not `httpx` - the standard library's `urllib` is enough, and
`dependencies = []` is half of what this package promises. A test reads that list and fails if
it ever grows.

Requires Python 3.11 or newer.

## Licence

Apache-2.0
