"""Error type raised for any non-2xx response from the unpii API.

Charter (this repo's AGENTS.md): error messages never cite the input. The same discipline applies here on the
client side: an `UnpiiError`'s message is built ONLY from the HTTP status and
a validated `code` — never from the response body's message string and never
from anything the caller passed in. A body can carry either our own error
shape (`{"error": {"code": ..., "message": ...}}`) or Fastify's default 404
shape (`{"message": ..., "error": "Not Found", "statusCode": 404}`, where
`error` is a STRING) — in neither case does that text belong in an exception
that might get printed, logged, or forwarded somewhere the caller didn't
expect.
"""

from __future__ import annotations

import re

# A `code` from the response body is trusted only if it looks like one of
# ours: lowercase snake_case, e.g. "tier_required", "missing_api_key". Fastify's
# default error body puts a human string ("Not Found") in the same-shaped
# `error` field for routes we don't have a handler for — that string must
# never leak into the message, so anything that doesn't match this shape
# becomes `None` rather than being trusted verbatim.
_CODE_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


class UnpiiError(Exception):
    """Raised for any non-2xx HTTP response from the unpii API.

    Attributes:
        status: HTTP status code, or 0 for a client-side failure that never
            reached the server (e.g. a missing API key).
        code: The server's machine-readable error code (e.g.
            "tier_required"), or None when the body carried no such code, an
            unrecognized shape, or wasn't parseable at all.
        request_id: The `x-request-id` response header, when present.
        retry_after: Seconds from a `Retry-After` response header (503
            `server_busy`, 429 `custom_rules_busy`, ...), or None when it was
            absent or not a plain non-negative integer. The HTTP-date form is
            deliberately not parsed: the server only ever sends seconds.
    """

    def __init__(
        self,
        status: int,
        code: str | None,
        request_id: str | None = None,
        retry_after: int | None = None,
    ) -> None:
        self.status = status
        self.code = code if code is not None and _CODE_RE.match(code) else None
        self.request_id = request_id
        self.retry_after = retry_after
        message = f"unpii: {self.code} (HTTP {status})" if self.code else f"unpii: HTTP {status}"
        super().__init__(message)


class UnpiiBusyError(UnpiiError):
    """Raised for 503 `server_busy`: the service is full right now and refused
    the request before doing any work. "Try again later" - not a fault in the
    request and not an outage; a different 503, `inference_unavailable` (model
    unreachable), stays a plain `UnpiiError`. The client never retries by
    itself: whether and when to try again is the caller's decision,
    `retry_after` is the server's hint for it."""

    def __init__(
        self, status: int, request_id: str | None = None, retry_after: int | None = None
    ) -> None:
        super().__init__(status, "server_busy", request_id, retry_after)


_RETRY_AFTER_RE = re.compile(r"^[0-9]{1,6}$")


def parse_retry_after(value: str | None) -> int | None:
    """Digits only, at most 6 of them (about 11 days); anything else is None."""
    if value is None:
        return None
    stripped = value.strip()
    return int(stripped) if _RETRY_AFTER_RE.match(stripped) else None
