from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any
from uuid import UUID


def encode_created_cursor(created_at: str, row_id: str) -> str:
    value = json.dumps([created_at, row_id], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def decode_created_cursor(cursor: str) -> tuple[str, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        value: Any = json.loads(base64.urlsafe_b64decode(padded).decode())
        if (
            not isinstance(value, list)
            or len(value) != 2
            or not all(isinstance(item, str) and item for item in value)
        ):
            raise ValueError
        created_at = datetime.fromisoformat(value[0].replace("Z", "+00:00"))
        if created_at.tzinfo is None:
            raise ValueError
        row_id = str(UUID(value[1]))
        return value[0], row_id
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("PAGINATION_CURSOR_INVALID") from exc


def decode_numeric_cursor(cursor: str) -> int:
    try:
        value = int(cursor)
    except (TypeError, ValueError) as exc:
        raise ValueError("PAGINATION_CURSOR_INVALID") from exc
    if value < 1:
        raise ValueError("PAGINATION_CURSOR_INVALID")
    return value
