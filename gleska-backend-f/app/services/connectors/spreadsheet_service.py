"""Spreadsheet parsing connector — reads Excel and CSV files."""

from __future__ import annotations

import csv
import io
import logging
from typing import Any

from app.core.supabase import supabase

logger = logging.getLogger(__name__)

BUCKET = "assistant-uploads"
DEFAULT_MAX_ROWS = 100


class SpreadsheetService:
    """Parse uploaded spreadsheet files into structured row data."""

    @staticmethod
    async def parse_spreadsheet(
        file_key: str,
        sheet_name: str | None = None,
        max_rows: int = DEFAULT_MAX_ROWS,
    ) -> dict[str, Any]:
        ext = "." + file_key.rsplit(".", 1)[-1].lower() if "." in file_key else ""
        max_rows = min(max_rows, 500)

        try:
            file_bytes = supabase.storage.from_(BUCKET).download(file_key)
        except Exception:
            logger.exception("Failed to download spreadsheet: %s", file_key)
            return {
                "headers": [],
                "rows": [],
                "total_rows": 0,
                "truncated": False,
                "error": "Failed to download file.",
            }

        if ext == ".csv":
            return SpreadsheetService._parse_csv(file_bytes, max_rows)
        if ext in (".xlsx", ".xls"):
            return SpreadsheetService._parse_excel(file_bytes, sheet_name, max_rows)

        return {
            "headers": [],
            "rows": [],
            "total_rows": 0,
            "truncated": False,
            "error": f"Unsupported spreadsheet format: {ext}",
        }

    @staticmethod
    def _parse_csv(file_bytes: bytes, max_rows: int) -> dict[str, Any]:
        try:
            text = file_bytes.decode("utf-8", errors="replace")
            reader = csv.reader(io.StringIO(text))
            all_rows = list(reader)
        except Exception:
            logger.exception("CSV parsing failed")
            return {
                "headers": [],
                "rows": [],
                "total_rows": 0,
                "truncated": False,
                "error": "Failed to parse CSV file.",
            }

        if not all_rows:
            return {"headers": [], "rows": [], "total_rows": 0, "truncated": False}

        headers = [str(h).strip() for h in all_rows[0]]
        data_rows = all_rows[1:]
        total = len(data_rows)
        truncated = total > max_rows
        returned_rows = data_rows[:max_rows]

        return {
            "headers": headers,
            "rows": returned_rows,
            "total_rows": total,
            "truncated": truncated,
            "sheet_name": "Sheet1",
        }

    @staticmethod
    def _parse_excel(
        file_bytes: bytes,
        sheet_name: str | None,
        max_rows: int,
    ) -> dict[str, Any]:
        try:
            from openpyxl import load_workbook
        except ImportError:
            logger.warning("openpyxl not installed — falling back to CSV-only spreadsheet parsing")
            return {
                "headers": [],
                "rows": [],
                "total_rows": 0,
                "truncated": False,
                "error": "Excel parsing requires openpyxl. Please install it or upload a CSV file.",
            }

        try:
            wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
            ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active
            if ws is None:
                return {"headers": [], "rows": [], "total_rows": 0, "truncated": False, "error": "No sheets found."}

            actual_sheet = ws.title or "Sheet1"
            all_rows: list[list[Any]] = []
            for row in ws.iter_rows(values_only=True):
                all_rows.append([cell if cell is not None else "" for cell in row])
            wb.close()
        except Exception:
            logger.exception("Excel parsing failed")
            return {
                "headers": [],
                "rows": [],
                "total_rows": 0,
                "truncated": False,
                "error": "Failed to parse Excel file.",
            }

        if not all_rows:
            return {"headers": [], "rows": [], "total_rows": 0, "truncated": False, "sheet_name": actual_sheet}

        headers = [str(h).strip() for h in all_rows[0]]
        data_rows = [[str(cell) for cell in row] for row in all_rows[1:]]
        total = len(data_rows)
        truncated = total > max_rows

        return {
            "headers": headers,
            "rows": data_rows[:max_rows],
            "total_rows": total,
            "truncated": truncated,
            "sheet_name": actual_sheet,
        }
