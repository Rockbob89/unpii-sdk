"""unpii — Python client for the unpii.me PII redaction API.

Zero runtime dependencies (standard library only).

    from unpii import Client, restore

    res = Client(api_key=os.environ["UNPII_API_KEY"]).anonymize("Hallo Anne Schmitz")
    back = restore(answer_from_llm, res.spans)
"""

from .client import (
    AnonymizeResult,
    AnonymizeStats,
    Client,
    FileResult,
    FileStats,
    FileWarning,
    ScanResult,
    Span,
)
from .errors import UnpiiError
from .restore import RestoreResult, restore

__all__ = [
    "AnonymizeResult",
    "AnonymizeStats",
    "Client",
    "FileResult",
    "FileStats",
    "FileWarning",
    "RestoreResult",
    "ScanResult",
    "Span",
    "UnpiiError",
    "restore",
]
