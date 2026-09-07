"""HTTP client for the unpii.me PII redaction API.

Stdlib only (`urllib.request`, `json`, `mimetypes`, `uuid`) — no third-party
dependency. See `pyproject.toml`'s `dependencies = []` and the test that
asserts it stays that way.

This client reads NO environment variables. `UNPII_API_KEY` /
`UNPII_BASE_URL` are the CLI's job, not the SDK's — a library that reaches
into the environment behind the caller's back is a worse citizen for
anything that embeds it.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from email.message import Message
from typing import Any

from .errors import UnpiiError

_DEFAULT_BASE_URL = "https://unpii.me"
_DEFAULT_TIMEOUT = 120.0


@dataclass
class Span:
    """One detected PII span. Mirrors the server's `Span` schema field-for-field
    — the wire names already are the Python names here, no camelCase to
    translate."""

    start: int
    end: int
    category: str
    id: int
    original: str
    score: float | None = None


@dataclass
class AnonymizeStats:
    """Mirrors the wire `AnonymizeStats` object, which itself mixes
    snake_case (`request_id`, `processed_chars`) and camelCase (`servedBy`)
    — that split is the real contract, not a Python naming choice, so
    `served_by` is the one field translated from the wire name."""

    request_id: str
    processed_chars: int
    served_by: str


@dataclass
class AnonymizeResult:
    anonymized: str
    spans: list[Span]
    uncertain_spans: list[Span]
    stats: AnonymizeStats


@dataclass
class ScanResult:
    """POST /api/v1/scan response — same as AnonymizeResult minus the
    rendered `anonymized` text. The route does not exist on today's server;
    see Client.scan()'s docstring."""

    spans: list[Span]
    uncertain_spans: list[Span]
    stats: AnonymizeStats


@dataclass
class FileWarning:
    """`{code, detail}` from the wire. The server's `FileWarning` zod schema
    is `.passthrough()` (extra fields tolerated on its side too) — this
    dataclass keeps only the two fields every caller needs and drops
    anything else the server might attach, same "parse what we know" stance
    as the rest of this module."""

    code: str
    detail: str


@dataclass
class FileStats:
    """Stats shape for /anonymize-file, distinct from AnonymizeStats: the
    wire field is `extractedChars` (camelCase), not `processed_chars`, and
    `servedBy` is a plain string there rather than the closed enum used by
    /anonymize. Modeled separately rather than reusing AnonymizeStats so a
    field rename on either side is a type error here, not a silent mismatch."""

    request_id: str
    extracted_chars: int
    served_by: str


@dataclass
class FileResult:
    """Response of POST /api/v1/anonymize-file, covering both response
    shapes the server can return: `AnonymizeFileResponse` (rebuilt document,
    `name`/`mime_type` set, `content` is the decoded document bytes) and
    `AnonymizeFileTextResponse` (`outputFormat="text"`, PDF input only,
    `name`/`mime_type` are None and `content` is the extracted text as a
    plain `str` rather than `bytes`)."""

    name: str | None
    mime_type: str | None
    content: bytes | str
    spans: list[Span]
    uncertain_spans: list[Span]
    warnings: list[FileWarning]
    stats: FileStats


# --- wire -> dataclass mapping. Each function parses only the fields it
# knows and ignores everything else, so a server that grows a new field
# (e.g. a future `receipt`) does not break an old client pinned to an
# earlier SDK version. ---


def _span_from_wire(data: dict[str, Any]) -> Span:
    return Span(
        start=data["start"],
        end=data["end"],
        category=data["category"],
        id=data["id"],
        original=data["original"],
        score=data.get("score"),
    )


def _spans_from_wire(items: list[dict[str, Any]]) -> list[Span]:
    return [_span_from_wire(item) for item in items]


def _stats_from_wire(data: dict[str, Any]) -> AnonymizeStats:
    return AnonymizeStats(
        request_id=data["request_id"],
        processed_chars=data["processed_chars"],
        served_by=data["servedBy"],
    )


def _file_stats_from_wire(data: dict[str, Any]) -> FileStats:
    return FileStats(
        request_id=data["request_id"],
        extracted_chars=data["extractedChars"],
        served_by=data["servedBy"],
    )


def _warning_from_wire(data: dict[str, Any]) -> FileWarning:
    return FileWarning(code=data["code"], detail=data["detail"])


class Client:
    """Talks to a single unpii deployment. One instance per API key."""

    def __init__(
        self,
        api_key: str,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        if not api_key or not api_key.strip():
            raise UnpiiError(0, "missing_api_key")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    # -- public API --------------------------------------------------

    def anonymize(
        self,
        text: str,
        *,
        marker_format: str | None = None,
        ambiguous: str | None = None,
        keep: list[str] | None = None,
        structure: bool | None = None,
    ) -> AnonymizeResult:
        """POST /api/v1/anonymize.

        `keep` and `structure` are accepted and sent, but honoured only by a
        later server release — today's server silently strips both (verified
        2026-09-07 by sending them and getting a 200 with unchanged
        behavior). They're already part of this signature so callers pinning
        an SDK version don't need a breaking bump once the server catches up.
        """
        body: dict[str, Any] = {"text": text}
        if marker_format is not None:
            body["markerFormat"] = marker_format
        if ambiguous is not None:
            body["ambiguous"] = ambiguous
        if keep is not None:
            body["keep"] = keep
        if structure is not None:
            body["structure"] = structure

        parsed = self._request("POST", "/api/v1/anonymize", json_body=body)
        return AnonymizeResult(
            anonymized=parsed["anonymized"],
            spans=_spans_from_wire(parsed["spans"]),
            uncertain_spans=_spans_from_wire(parsed["uncertainSpans"]),
            stats=_stats_from_wire(parsed["stats"]),
        )

    def scan(self, text: str) -> ScanResult:
        """POST /api/v1/scan — spans without the rendered anonymized text.

        This route does not exist on today's server; the contract implemented
        here is the one this package's `ScanResult` and the TypeScript SDK's
        hand-typed `ScanResponse` (`packages/sdk/src/types.ts`, this repo)
        define ahead of the server shipping it. Against today's server this
        call raises `UnpiiError(404, None, ...)` — Fastify's default
        not-found handler has no route-specific `code`.
        """
        parsed = self._request("POST", "/api/v1/scan", json_body={"text": text})
        return ScanResult(
            spans=_spans_from_wire(parsed["spans"]),
            uncertain_spans=_spans_from_wire(parsed["uncertainSpans"]),
            stats=_stats_from_wire(parsed["stats"]),
        )

    def anonymize_file(
        self,
        data: bytes,
        *,
        filename: str,
        marker_format: str | None = None,
        output_format: str | None = None,
        redact_uncertain: bool | None = None,
    ) -> FileResult:
        """POST /api/v1/anonymize-file, multipart/form-data built by hand
        (stdlib only, no `requests`).

        CRITICAL and load-bearing: the `markerFormat`, `redactUncertain` and
        `outputFormat` parts are written BEFORE the `file` part — the
        server's multipart parser does not reliably read fields that follow
        the file part. This is server behavior, not a Python-side design
        choice: the identical law is documented and enforced in the
        TypeScript SDK's own `anonymizeFile()`, also in this repo
        (`packages/sdk/src/client.ts`), so the field order here is not
        negotiable.
        """
        boundary = uuid.uuid4().hex
        parts: list[bytes] = []

        def add_field(name: str, value: str) -> None:
            parts.append(
                (
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                    f"{value}\r\n"
                ).encode()
            )

        # Field parts BEFORE the file part — see the docstring above.
        if marker_format is not None:
            add_field("markerFormat", marker_format)
        if redact_uncertain is not None:
            add_field("redactUncertain", "true" if redact_uncertain else "false")
        if output_format is not None:
            add_field("outputFormat", output_format)

        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode()
        )
        parts.append(data)
        parts.append(f"\r\n--{boundary}--\r\n".encode())

        body = b"".join(parts)
        parsed = self._request(
            "POST",
            "/api/v1/anonymize-file",
            raw_body=body,
            extra_headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )

        if "text" in parsed:
            # AnonymizeFileTextResponse: outputFormat="text" (PDF only). No
            # `file` object on the wire, so name/mime_type stay None.
            return FileResult(
                name=None,
                mime_type=None,
                content=parsed["text"],
                spans=_spans_from_wire(parsed["spans"]),
                uncertain_spans=_spans_from_wire(parsed["uncertainSpans"]),
                warnings=[_warning_from_wire(w) for w in parsed["warnings"]],
                stats=_file_stats_from_wire(parsed["stats"]),
            )

        file_obj = parsed["file"]
        return FileResult(
            name=file_obj["name"],
            mime_type=file_obj["mimeType"],
            content=base64.b64decode(file_obj["contentBase64"]),
            spans=_spans_from_wire(parsed["spans"]),
            uncertain_spans=_spans_from_wire(parsed["uncertainSpans"]),
            warnings=[_warning_from_wire(w) for w in parsed["warnings"]],
            stats=_file_stats_from_wire(parsed["stats"]),
        )

    def limits(self) -> dict[str, Any]:
        """GET /api/v1/limits. Returned as the parsed dict verbatim — the
        response shape (current/reference/burst/legacy fields) is still
        settling server-side, so this is deliberately not wrapped in a
        dataclass yet."""
        return self._request("GET", "/api/v1/limits")

    # -- shared request/error plumbing --------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        raw_body: bytes | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        """Send one HTTP request and return the parsed JSON body on 2xx.

        Raises `UnpiiError` — and only `UnpiiError` — for every failure
        mode: a non-2xx status (whatever shape or absence of body it
        carries), a response body that isn't valid JSON, and a network-level
        failure that never reached the server. Never lets `json.JSONDecodeError`,
        `urllib.error.URLError`, or anything else escape this method.
        """
        url = f"{self._base_url}{path}"
        headers: dict[str, str] = {"Authorization": f"Bearer {self._api_key}"}
        if json_body is not None:
            body: bytes | None = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        else:
            body = raw_body
        if extra_headers:
            headers.update(extra_headers)

        request = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                status = response.status
                resp_headers: Message = response.headers
                resp_body = response.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            resp_headers = exc.headers
            resp_body = exc.read()
        except urllib.error.URLError as exc:
            # Never reached the server at all (DNS, connection refused,
            # timeout, ...) — still surfaces as UnpiiError, never a raw
            # urllib exception, per this method's contract.
            raise UnpiiError(0, "connection_error") from exc

        request_id = resp_headers.get("x-request-id") if resp_headers is not None else None

        if not (200 <= status < 300):
            raise UnpiiError(status, _extract_error_code(resp_body), request_id)

        if not resp_body:
            return {}
        try:
            return json.loads(resp_body)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise UnpiiError(status, None, request_id) from exc


def _extract_error_code(resp_body: bytes) -> str | None:
    """Pull `error.code` out of an error response body, tolerating every
    shape it might come in: our own `{"error": {"code": ...}}`, Fastify's
    default `{"error": "Not Found", ...}` (a STRING, not an object — see
    `fixtures/error.route-not-found.json`), non-JSON bytes, and
    an empty body. Anything that doesn't fit hands back `None`; `UnpiiError`
    itself does the final validation against the code-shape regex."""
    if not resp_body:
        return None
    try:
        parsed = json.loads(resp_body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(parsed, dict):
        return None
    error = parsed.get("error")
    if not isinstance(error, dict):
        return None
    code = error.get("code")
    return code if isinstance(code, str) else None
