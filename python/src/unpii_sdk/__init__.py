"""unpii — Python client for the unpii.me PII redaction API.

Zero runtime dependencies (standard library only).

    from unpii_sdk import Unpii, restore

    res = Unpii(api_key=os.environ["UNPII_API_KEY"]).anonymize("Hallo Anne Schmitz")
    back = restore(answer_from_llm, res.spans)
"""

from .client import (
    AnonymizeResult,
    AnonymizeStats,
    FileResult,
    FileStats,
    FileWarning,
    ScanResult,
    Span,
    Unpii,
)
from .errors import UnpiiError
from .restore import RestoreResult, restore

__all__ = [
    "AnonymizeResult",
    "AnonymizeStats",
    "FileResult",
    "FileStats",
    "FileWarning",
    "RestoreResult",
    "ScanResult",
    "Span",
    "Unpii",
    "UnpiiError",
    "restore",
]
