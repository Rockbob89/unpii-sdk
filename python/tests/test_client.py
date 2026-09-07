"""Tests for unpii.client.Client against a real local HTTP server (stdlib
http.server), using response fixtures captured from the real unpii.me API —
see fixtures/README.md for exact provenance. Never hand-written stubs for
the error shapes: a hand-written stub is what let a real integration bug
reach production green once before, so every error-shape fixture here is a
byte-identical capture, not something typed by hand.
"""

from __future__ import annotations

import base64
import json
import os
import threading
import tomllib
from collections.abc import Iterator
from dataclasses import dataclass, field
from email.message import Message
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from unpii.client import Client
from unpii.errors import UnpiiError

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "fixtures"
PYPROJECT_PATH = Path(__file__).resolve().parent.parent / "pyproject.toml"


def load_fixture(name: str) -> bytes:
    return (FIXTURES_DIR / name).read_bytes()


@dataclass
class RecordedRequest:
    method: str
    path: str
    headers: Message
    body: bytes


@dataclass
class _Stub:
    """One canned response: what to send back, keyed by (method, path)."""

    status: int
    body: bytes
    headers: dict[str, str] = field(default_factory=dict)


class _StubServer(ThreadingHTTPServer):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.received: list[RecordedRequest] = []
        self.responses: dict[tuple[str, str], list[_Stub]] = {}

    def queue(self, method: str, path: str, stub: _Stub) -> None:
        self.responses.setdefault((method, path), []).append(stub)

    def next_response(self, method: str, path: str) -> _Stub:
        queue = self.responses.get((method, path))
        if not queue:
            return _Stub(500, b'{"error":{"code":"no_stub","message":"no stub registered"}}')
        return queue.pop(0)

    @property
    def base_url(self) -> str:
        host, port = self.server_address[:2]
        return f"http://{host}:{port}"


class _Handler(BaseHTTPRequestHandler):
    server: _StubServer  # type: ignore[assignment]

    def log_message(self, format_: str, *args: Any) -> None:
        pass  # silence default access logging during tests

    def _handle(self, method: str) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        self.server.received.append(
            RecordedRequest(method=method, path=self.path, headers=self.headers, body=body)
        )
        stub = self.server.next_response(method, self.path)
        self.send_response(stub.status)
        for key, value in stub.headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(stub.body)))
        self.end_headers()
        if stub.body:
            self.wfile.write(stub.body)

    def do_GET(self) -> None:
        self._handle("GET")

    def do_POST(self) -> None:
        self._handle("POST")


@pytest.fixture
def server() -> Iterator[_StubServer]:
    srv = _StubServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        yield srv
    finally:
        srv.shutdown()
        thread.join(timeout=5)


API_KEY = "ak_test_key_123"


# --- anonymize() ------------------------------------------------------


def test_anonymize_sends_bearer_auth_and_omits_none_fields(server: _StubServer) -> None:
    server.queue(
        "POST",
        "/api/v1/anonymize",
        _Stub(200, load_fixture("anonymize.docs.json")),
    )
    client = Client(api_key=API_KEY, base_url=server.base_url)

    result = client.anonymize("Hallo Anne Schmitz", marker_format="default")

    assert len(server.received) == 1
    req = server.received[0]
    assert req.method == "POST"
    assert req.path == "/api/v1/anonymize"
    assert req.headers.get("Authorization") == f"Bearer {API_KEY}"
    body = json.loads(req.body)
    # ambiguous/keep/structure were never passed -> OMITTED, not null.
    assert body == {"text": "Hallo Anne Schmitz", "markerFormat": "default"}

    fixture = json.loads(load_fixture("anonymize.docs.json"))
    assert result.anonymized == fixture["anonymized"]
    assert len(result.spans) == len(fixture["spans"])
    assert result.spans[0].category == fixture["spans"][0]["category"]
    assert result.spans[0].original == fixture["spans"][0]["original"]
    assert result.stats.request_id == fixture["stats"]["request_id"]
    assert result.stats.processed_chars == fixture["stats"]["processed_chars"]
    assert result.stats.served_by == fixture["stats"]["servedBy"]


def test_anonymize_anon_response_shape(server: _StubServer) -> None:
    """The anonymous (unauthenticated) fixture uses masked markers and the
    REDACTED category — same parser must handle both without special-casing."""
    server.queue("POST", "/api/v1/anonymize", _Stub(200, load_fixture("anonymize.anon.json")))
    client = Client(api_key=API_KEY, base_url=server.base_url)

    result = client.anonymize("Hallo Anne Schmitz")

    fixture = json.loads(load_fixture("anonymize.anon.json"))
    assert result.anonymized == fixture["anonymized"]
    assert result.spans[0].category == "REDACTED"
    assert result.uncertain_spans == []


def test_anonymize_all_optional_fields_sent(server: _StubServer) -> None:
    server.queue("POST", "/api/v1/anonymize", _Stub(200, load_fixture("anonymize.docs.json")))
    client = Client(api_key=API_KEY, base_url=server.base_url)

    client.anonymize(
        "text", marker_format="custom", ambiguous="mark", keep=["DATE", "URL"], structure=True
    )

    body = json.loads(server.received[0].body)
    assert body == {
        "text": "text",
        "markerFormat": "custom",
        "ambiguous": "mark",
        "keep": ["DATE", "URL"],
        "structure": True,
    }


# --- scan() -------------------------------------------------------------


def test_scan_against_todays_server_raises_404_with_no_code(server: _StubServer) -> None:
    """The /scan route does not exist on today's server; Fastify's default
    404 handler returns {"error": "Not Found"} (a STRING), so `code` is None."""
    server.queue("POST", "/api/v1/scan", _Stub(404, load_fixture("error.route-not-found.json")))
    client = Client(api_key=API_KEY, base_url=server.base_url)

    with pytest.raises(UnpiiError) as exc_info:
        client.scan("some text")

    assert exc_info.value.status == 404
    assert exc_info.value.code is None


# --- anonymize_file() ----------------------------------------------------


def test_anonymize_file_multipart_field_order_and_parsing(server: _StubServer) -> None:
    server.queue(
        "POST", "/api/v1/anonymize-file", _Stub(200, load_fixture("anonymize-file.docx.json"))
    )
    client = Client(api_key=API_KEY, base_url=server.base_url)

    result = client.anonymize_file(
        b"fake docx bytes",
        filename="report.docx",
        marker_format="default",
        redact_uncertain=True,
        output_format="docx",
    )

    req = server.received[0]
    assert req.method == "POST"
    assert req.path == "/api/v1/anonymize-file"
    assert req.headers.get("Authorization") == f"Bearer {API_KEY}"
    content_type = req.headers.get("Content-Type") or ""
    assert content_type.startswith("multipart/form-data; boundary=")

    # CRITICAL field order: markerFormat, redactUncertain and outputFormat
    # must all precede the file part — the server's multipart parser does
    # not reliably read fields that follow it.
    body = req.body
    pos_marker = body.find(b'name="markerFormat"')
    pos_redact = body.find(b'name="redactUncertain"')
    pos_output = body.find(b'name="outputFormat"')
    pos_file = body.find(b'name="file"')
    assert -1 not in (pos_marker, pos_redact, pos_output, pos_file)
    assert pos_marker < pos_file
    assert pos_redact < pos_file
    assert pos_output < pos_file
    assert b"fake docx bytes" in body

    fixture = json.loads(load_fixture("anonymize-file.docx.json"))
    assert result.name == fixture["file"]["name"]
    assert result.mime_type == fixture["file"]["mimeType"]
    assert result.content == base64.b64decode(fixture["file"]["contentBase64"])
    assert len(result.spans) == len(fixture["spans"])
    assert len(result.uncertain_spans) == len(fixture["uncertainSpans"])
    assert result.stats.request_id == fixture["stats"]["request_id"]
    assert result.stats.extracted_chars == fixture["stats"]["extractedChars"]


def test_anonymize_file_omits_optional_fields_when_not_given(server: _StubServer) -> None:
    server.queue(
        "POST", "/api/v1/anonymize-file", _Stub(200, load_fixture("anonymize-file.docx.json"))
    )
    client = Client(api_key=API_KEY, base_url=server.base_url)

    client.anonymize_file(b"bytes", filename="a.docx")

    body = server.received[0].body
    assert b'name="markerFormat"' not in body
    assert b'name="redactUncertain"' not in body
    assert b'name="outputFormat"' not in body
    assert b'name="file"' in body


# --- limits() -------------------------------------------------------------


def test_limits_returns_parsed_dict_verbatim(server: _StubServer) -> None:
    payload = {"current": {"tier": "docs"}, "reference": {"web": {}}, "burst": {}}
    server.queue(
        "GET", "/api/v1/limits", _Stub(200, json.dumps(payload).encode("utf-8"))
    )
    client = Client(api_key=API_KEY, base_url=server.base_url)

    result = client.limits()

    assert result == payload
    assert server.received[0].method == "GET"


# --- error handling ---------------------------------------------------


def test_402_tier_required_body_shape(server: _StubServer) -> None:
    server.queue(
        "POST", "/api/v1/anonymize", _Stub(402, load_fixture("error.tier-required.json"))
    )
    client = Client(api_key=API_KEY, base_url=server.base_url)

    with pytest.raises(UnpiiError) as exc_info:
        client.anonymize("text", marker_format="default")

    assert exc_info.value.status == 402
    assert exc_info.value.code == "tier_required"


def test_404_route_not_found_string_error_shape(server: _StubServer) -> None:
    """error.route-not-found.json's `error` field is a STRING ("Not Found"),
    not an object — the parser must not crash trying to read `.code` off it,
    and must not surface that string as `code` either."""
    server.queue(
        "POST", "/api/v1/anonymize", _Stub(404, load_fixture("error.route-not-found.json"))
    )
    client = Client(api_key=API_KEY, base_url=server.base_url)

    with pytest.raises(UnpiiError) as exc_info:
        client.anonymize("text")

    assert exc_info.value.status == 404
    assert exc_info.value.code is None


def test_non_json_body_raises_unpii_error(server: _StubServer) -> None:
    server.queue("POST", "/api/v1/anonymize", _Stub(500, b"<html>not json at all</html>"))
    client = Client(api_key=API_KEY, base_url=server.base_url)

    with pytest.raises(UnpiiError) as exc_info:
        client.anonymize("text")

    assert exc_info.value.status == 500
    assert exc_info.value.code is None


def test_empty_body_raises_unpii_error(server: _StubServer) -> None:
    server.queue("POST", "/api/v1/anonymize", _Stub(500, b""))
    client = Client(api_key=API_KEY, base_url=server.base_url)

    with pytest.raises(UnpiiError) as exc_info:
        client.anonymize("text")

    assert exc_info.value.status == 500
    assert exc_info.value.code is None


def test_error_message_never_contains_body_or_input(server: _StubServer) -> None:
    secret_input = "Anne Schmitz lives at Schellingstrasse 42"
    body_message = "leaked-original-value-should-never-appear-in-str(err)"
    poisoned_body = json.dumps(
        {"error": {"code": "boom", "message": body_message, "original": secret_input}}
    ).encode("utf-8")
    server.queue("POST", "/api/v1/anonymize", _Stub(500, poisoned_body))
    client = Client(api_key=API_KEY, base_url=server.base_url)

    with pytest.raises(UnpiiError) as exc_info:
        client.anonymize(secret_input)

    text = str(exc_info.value)
    assert secret_input not in text
    assert body_message not in text
    assert "boom" in text  # the validated code IS allowed in the message


# --- request_id from x-request-id header -----------------------------


def test_request_id_read_from_header(server: _StubServer) -> None:
    server.queue(
        "POST",
        "/api/v1/anonymize",
        _Stub(402, load_fixture("error.tier-required.json"), headers={"x-request-id": "req-xyz"}),
    )
    client = Client(api_key=API_KEY, base_url=server.base_url)

    with pytest.raises(UnpiiError) as exc_info:
        client.anonymize("text", marker_format="default")

    assert exc_info.value.request_id == "req-xyz"


# --- construction ------------------------------------------------------


@pytest.mark.parametrize("bad_key", ["", "   ", "\t\n"])
def test_empty_api_key_raises(bad_key: str) -> None:
    with pytest.raises(UnpiiError) as exc_info:
        Client(api_key=bad_key)

    assert exc_info.value.code == "missing_api_key"
    assert exc_info.value.status == 0


def test_env_base_url_is_never_read(server: _StubServer, monkeypatch: pytest.MonkeyPatch) -> None:
    """The client reads NO environment variables — UNPII_BASE_URL is the
    CLI's job. Point the env var at an address nothing is listening on; if
    the client secretly consulted it, this request would fail to connect."""
    monkeypatch.setenv("UNPII_BASE_URL", "http://127.0.0.1:1")
    assert os.environ["UNPII_BASE_URL"] == "http://127.0.0.1:1"

    server.queue("GET", "/api/v1/limits", _Stub(200, b"{}"))
    client = Client(api_key=API_KEY, base_url=server.base_url)

    client.limits()  # must reach the stub server, not the env value

    assert len(server.received) == 1


# --- packaging -----------------------------------------------------------


def test_pyproject_has_no_runtime_dependencies() -> None:
    with PYPROJECT_PATH.open("rb") as f:
        data = tomllib.load(f)

    assert data["project"]["dependencies"] == []
