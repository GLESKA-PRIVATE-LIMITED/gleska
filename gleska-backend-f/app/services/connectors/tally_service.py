"""TallyPrime connector — fetches accounting data via Tally XML API."""

from __future__ import annotations

import logging
from typing import Any
from xml.etree import ElementTree

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class TallyService:
    """Retrieve financial data from TallyPrime through the AI Assistant.

    TallyPrime exposes an XML-based API on a local port (default 9000).
    The employer must have Tally running with ODBC/API server enabled.
    """

    @staticmethod
    async def fetch_data(
        query_type: str,
        employer_id: str,
        company_name: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> dict[str, Any]:
        tally_url = getattr(settings, "TALLY_API_URL", "").strip()
        if not tally_url:
            return {
                "success": False,
                "data": {},
                "summary": (
                    "TallyPrime is not configured. Please set the TALLY_API_URL in your "
                    "environment settings (typically http://localhost:9000) and ensure Tally "
                    "is running with the API server enabled."
                ),
            }

        xml_request = TallyService._build_xml_request(query_type, company_name, date_from, date_to)
        if not xml_request:
            return {"success": False, "data": {}, "summary": f"Unsupported query type: {query_type}"}

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(
                    tally_url,
                    content=xml_request,
                    headers={"Content-Type": "text/xml"},
                )

            if response.status_code != 200:
                return {"success": False, "data": {}, "summary": f"TallyPrime returned status {response.status_code}."}

            parsed = TallyService._parse_response(response.text, query_type)
            return parsed

        except httpx.ConnectError:
            return {
                "success": False,
                "data": {},
                "summary": "Could not connect to TallyPrime. Ensure Tally is running and the API server is enabled.",
            }
        except httpx.TimeoutException:
            return {"success": False, "data": {}, "summary": "TallyPrime request timed out."}
        except Exception:
            logger.exception("TallyPrime query error")
            return {"success": False, "data": {}, "summary": "TallyPrime query encountered an error."}

    @staticmethod
    def _build_xml_request(
        query_type: str,
        company_name: str | None,
        date_from: str | None,
        date_to: str | None,
    ) -> str | None:
        company_tag = f"<SVCURRENTCOMPANY>{company_name}</SVCURRENTCOMPANY>" if company_name else ""
        date_range = ""
        if date_from and date_to:
            date_range = f"<FROMDATE>{date_from.replace('-', '')}</FROMDATE><TODATE>{date_to.replace('-', '')}</TODATE>"

        if query_type == "salary_budget":
            return f"""<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC>
<REPORTNAME>Trial Balance</REPORTNAME>
{company_tag}{date_range}
<STATICVARIABLES><EXPLODEFLAG>Yes</EXPLODEFLAG></STATICVARIABLES>
</REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>"""

        if query_type == "payment_history":
            return f"""<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC>
<REPORTNAME>Day Book</REPORTNAME>
{company_tag}{date_range}
</REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>"""

        if query_type == "ledger_balance":
            return f"""<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC>
<REPORTNAME>Balance Sheet</REPORTNAME>
{company_tag}{date_range}
</REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>"""

        return None

    @staticmethod
    def _parse_response(xml_text: str, query_type: str) -> dict[str, Any]:
        try:
            root = ElementTree.fromstring(xml_text)
        except ElementTree.ParseError:
            return {"success": False, "data": {}, "summary": "Invalid response from TallyPrime."}

        entries: list[dict[str, str]] = []
        for ledger in root.iter("DSPACCNAME"):
            name = (ledger.text or "").strip()
            amount_el = ledger.find("../DSPCLDRAMT")
            amount = (amount_el.text or "0").strip() if amount_el is not None else "0"
            if name:
                entries.append({"name": name, "amount": amount})

        if not entries:
            for elem in root.iter():
                if elem.text and elem.text.strip():
                    entries.append({"field": elem.tag, "value": elem.text.strip()})
                if len(entries) >= 50:
                    break

        return {
            "success": True,
            "data": {"entries": entries[:100], "query_type": query_type},
            "summary": f"Retrieved {len(entries)} entries from TallyPrime ({query_type}).",
        }
