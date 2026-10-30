"""OCR & Document Intelligence connector — extracts text from uploaded files via Gemini."""

from __future__ import annotations

import base64
import csv
import io
import logging
from typing import Any

import httpx

from app.core.config import settings
from app.core.supabase import supabase

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".doc", ".docx", ".txt", ".csv",
    ".xlsx", ".xls", ".pptx", ".ppt",
}

MIME_MAP: dict[str, str] = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ppt": "application/vnd.ms-powerpoint",
}

ANALYSIS_PROMPTS: dict[str, str] = {
    "job_requirements": (
        "Extract job requirements from this document. Identify: job title, number of workers needed, "
        "required skills, experience requirements, salary/wage information, work timing, duration, "
        "location, and any other relevant hiring details. Return structured data."
    ),
    "worker_list": (
        "Extract worker/employee information from this document. Identify: names, phone numbers, "
        "skills, experience, trade/occupation, availability, and any other worker profile data. "
        "Return structured data as a list of workers."
    ),
    "salary_data": (
        "Extract salary and financial data from this document. Identify: wage rates, salary structures, "
        "payment schedules, deductions, allowances, and budget information. Return structured data."
    ),
    "general": (
        "Extract all meaningful text and data from this document. Identify the document type and "
        "summarize its contents with any structured data found."
    ),
}

BUCKET = "assistant-uploads"


class OCRService:
    """Extract text and structured data from uploaded documents using Gemini vision."""

    @staticmethod
    async def analyze_document(
        file_key: str,
        analysis_intent: str,
        employer_id: str,
    ) -> dict[str, Any]:
        ext = "." + file_key.rsplit(".", 1)[-1].lower() if "." in file_key else ""
        if ext not in SUPPORTED_EXTENSIONS:
            return {
                "extracted_text": "",
                "structured_data": {},
                "document_type": "unsupported",
                "confidence": 0.0,
                "error": f"Unsupported file type: {ext}",
            }

        if ext in (".txt", ".csv"):
            return await OCRService._handle_text_file(file_key, ext, analysis_intent, employer_id)

        return await OCRService._handle_with_gemini(file_key, ext, analysis_intent, employer_id)

    @staticmethod
    async def _handle_text_file(
        file_key: str,
        ext: str,
        analysis_intent: str,
        employer_id: str,
    ) -> dict[str, Any]:
        try:
            response = supabase.storage.from_(BUCKET).download(file_key)
            text = response.decode("utf-8", errors="replace")
        except Exception:
            logger.exception("Failed to download text file: %s", file_key)
            return {
                "extracted_text": "",
                "structured_data": {},
                "document_type": ext.lstrip("."),
                "confidence": 0.0,
                "error": "Failed to read file.",
            }

        structured: dict[str, Any] = {}
        if ext == ".csv":
            try:
                reader = csv.DictReader(io.StringIO(text))
                rows = list(reader)[:200]
                structured = {
                    "headers": reader.fieldnames or [],
                    "row_count": len(rows),
                    "sample_rows": rows[:10],
                }
            except csv.Error:
                pass

        return {
            "extracted_text": text[:50_000],
            "structured_data": structured,
            "document_type": ext.lstrip("."),
            "confidence": 1.0,
        }

    @staticmethod
    async def _handle_with_gemini(
        file_key: str,
        ext: str,
        analysis_intent: str,
        employer_id: str,
    ) -> dict[str, Any]:
        api_key = settings.GEMINI_API_KEY.strip()
        model = settings.GEMINI_MODEL.strip()
        if not api_key or not model:
            return {
                "extracted_text": "",
                "structured_data": {},
                "document_type": ext.lstrip("."),
                "confidence": 0.0,
                "error": "OCR service not configured.",
            }

        try:
            file_bytes = supabase.storage.from_(BUCKET).download(file_key)
        except Exception:
            logger.exception("Failed to download file for OCR: %s", file_key)
            return {
                "extracted_text": "",
                "structured_data": {},
                "document_type": ext.lstrip("."),
                "confidence": 0.0,
                "error": "Failed to download file.",
            }

        b64 = base64.b64encode(file_bytes).decode()
        mime = MIME_MAP.get(ext, "application/octet-stream")
        prompt = ANALYSIS_PROMPTS.get(analysis_intent, ANALYSIS_PROMPTS["general"])

        payload = {
            "contents": [{
                "parts": [
                    {"inline_data": {"mime_type": mime, "data": b64}},
                    {"text": prompt},
                ],
            }],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {
                        "extracted_text": {"type": "STRING"},
                        "structured_data": {"type": "OBJECT"},
                        "document_type": {"type": "STRING"},
                        "confidence": {"type": "NUMBER"},
                    },
                    "required": ["extracted_text", "document_type"],
                },
            },
        }

        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        timeout = settings.FINANCIAL_SCAN_GEMINI_TIMEOUT_SECONDS

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    endpoint,
                    headers={"x-goog-api-key": api_key, "content-type": "application/json"},
                    json=payload,
                )

            if resp.status_code >= 400:
                logger.error("Gemini OCR failed: status=%d", resp.status_code)
                return {
                    "extracted_text": "",
                    "structured_data": {},
                    "document_type": ext.lstrip("."),
                    "confidence": 0.0,
                    "error": "OCR processing failed.",
                }

            import json
            body = resp.json()
            raw_text = body["candidates"][0]["content"]["parts"][0]["text"]
            result = json.loads(raw_text)
            return {
                "extracted_text": str(result.get("extracted_text", ""))[:50_000],
                "structured_data": result.get("structured_data") or {},
                "document_type": str(result.get("document_type", ext.lstrip("."))),
                "confidence": float(result.get("confidence", 0.8)),
            }
        except Exception:
            logger.exception("Gemini OCR processing error for file: %s", file_key)
            return {
                "extracted_text": "",
                "structured_data": {},
                "document_type": ext.lstrip("."),
                "confidence": 0.0,
                "error": "OCR processing encountered an error.",
            }
