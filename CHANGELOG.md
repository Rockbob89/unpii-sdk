# Changelog

## 0.2.0

Versions of `@unpii/sdk`, `@unpii/cli` and `unpii-sdk` move together.

### Breaking

- Plan keys `docs` and `api` are now `plus` (`LimitsResponse`: `current.tier`, `reference.*`).
- Python: `anonymize(structure=...)` takes a string (`auto`, `text`, `json`, `csv`), no longer a
  bool; `True` is not valid.

### Added

- `UnpiiBusyError` (subclass of `UnpiiError`) for 503 `server_busy`, in the TypeScript SDK and the
  Python client. `UnpiiError` carries `retryAfterSeconds` / `retry_after` from the `Retry-After`
  header. No automatic retry.
- New fields in anonymize responses: `stats.counts`, `stats.uncertainCount`, `stats.structure`,
  `receipt` (nullable), `source` on spans. The server delivers them from its next deploy on.
- CLI: sentence for a busy server with the wait time, messages for `inference_unavailable` and
  `unsupported_marker_format`, `--marker pseudonym`.

### Fixed

- A string `error` field (`{"error": "server_busy"}`) is read as the error code; before it was
  treated as no code.
