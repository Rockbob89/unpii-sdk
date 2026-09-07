# unpii

Command-line client for [unpii](https://unpii.me) - send text, Markdown, or a `.docx`/`.pdf`, get
it back with the personal data replaced by category-specific markers.

```bash
npx unpii --help
```

No install needed - `npx unpii` fetches and runs it for one call.

Three lines to your first redaction:

```bash
cat prod.log | npx unpii > prod.anon.log
npx unpii vertrag.docx --out vertrag.anon.docx
```

## Where the key comes from

You need an API key, and API keys come with a paid plan. Create one at
<https://unpii.me/de/account/api-keys>.

```bash
export UNPII_API_KEY=ak_...
# or, to keep it out of the environment too:
export UNPII_API_KEY_FILE=/path/to/key/file
```

**There is deliberately no `--key` flag.** A key passed as a command-line argument lands in your
shell history and in `ps` output for every other process on the machine to see. Use one of the two
environment variables instead.

## Options

```
unpii <file> [options]
unpii [options] < input
unpii restore --from <response.json> [answer-file]

Options:
  --out <path>       write the result to a file instead of stdout
  --scan             only the found spans as a table, without the text
  --json             print the full API response unchanged (for restore)
  --marker <format>  default | custom | xxxxx | blackbar
  --keep <a,b,...>   comma-separated categories to exclude from redaction
                     (the current server still ignores this option)
  --from <path>      (restore only) a saved --json response
  --help             this help
  --version          version number

Environment variables:
  UNPII_API_KEY       API key
  UNPII_API_KEY_FILE  file containing the API key (read trimmed)
  UNPII_BASE_URL      base URL, default https://unpii.me
```

Without a path, input is read from stdin. The file type is detected from both the extension and
the first bytes; when they disagree, the bytes win.

Run `npx unpii --help` for the same text your installed version actually ships, including the
examples.

## Exit codes

```
0  success
1  API or runtime error
2  usage error or missing key
```

## Translating back

`unpii restore --from result.json answer.md` puts the original values back into an LLM's answer
that still contains the markers. It makes **no network call and needs no API key** - it is a pure
local re-substitution over a response you already have on disk:

```bash
npx unpii --json vertrag.txt > result.json
# ... send result's anonymized text to your LLM, get an answer back ...
npx unpii restore --from result.json answer.md > answer.klartext.md
```

## What this tool writes

**It writes no file unless you pass `--out`.** No temp file, no cache, no log. Without `--out`,
the result goes to stdout and nothing else touches disk.

**Errors never quote your input.** A failed request prints one sentence built from the HTTP status
and the server's error code, never the response body and never the text or file you sent - the
whole point of this tool is to keep personal data out of exactly the places an error message ends
up: logs, issue trackers, screenshots.

## `--scan` and older servers

`--scan` needs a server version that offers the `/api/v1/scan` route. An older deployment answers
404 for it; the tool then prints a plain sentence saying this server does not offer scanning yet,
rather than a bare HTTP error.

## Licence

Apache-2.0
