"""Google Forms connector — creates application forms."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.services.connectors import token_store

logger = logging.getLogger(__name__)

FORMS_API_BASE = "https://forms.googleapis.com/v1/forms"


class FormsService:
    """Create Google Forms through the AI Assistant."""

    @staticmethod
    async def create_form(
        job_title: str,
        questions: list[dict[str, Any]],
        employer_id: str,
        collect_email: bool = True,
    ) -> dict[str, Any]:
        credential = await token_store.get_credential(employer_id, "google_forms")
        access_token = credential.token
        if not access_token:
            return {
                "created": False,
                "error": credential.error_message("Google Forms"),
            }

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=20) as client:
                create_resp = await client.post(
                    FORMS_API_BASE,
                    json={"info": {"title": f"Job Application — {job_title}"}},
                    headers=headers,
                )

                if create_resp.status_code not in (200, 201):
                    if create_resp.status_code == 401:
                        return {"created": False, "error": "Google Forms token expired. Please reconnect."}
                    return {"created": False, "error": f"Forms API returned status {create_resp.status_code}."}

                form = create_resp.json()
                form_id = form.get("formId", "")
                form_url = form.get("responderUri", f"https://docs.google.com/forms/d/{form_id}/viewform")

                requests_list: list[dict[str, Any]] = []
                for idx, q in enumerate(questions[:20]):
                    item: dict[str, Any] = {
                        "createItem": {
                            "item": {
                                "title": q["text"],
                                "questionItem": {
                                    "question": FormsService._build_question(q),
                                },
                            },
                            "location": {"index": idx},
                        },
                    }
                    requests_list.append(item)

                if collect_email:
                    requests_list.append({
                        "updateSettings": {
                            "settings": {"quizSettings": {"isQuiz": False}},
                            "updateMask": "quizSettings.isQuiz",
                        },
                    })

                if requests_list:
                    await client.post(
                        f"{FORMS_API_BASE}/{form_id}:batchUpdate",
                        json={"requests": requests_list},
                        headers=headers,
                    )

                return {
                    "created": True,
                    "form_id": form_id,
                    "form_url": form_url,
                    "edit_url": f"https://docs.google.com/forms/d/{form_id}/edit",
                }

        except httpx.TimeoutException:
            return {"created": False, "error": "Forms service timed out."}
        except httpx.HTTPError:
            return {"created": False, "error": "Forms service connection error."}

    @staticmethod
    def _build_question(q: dict[str, Any]) -> dict[str, Any]:
        q_type = q.get("type", "text")
        required = q.get("required", False)

        if q_type == "choice" and q.get("options"):
            return {
                "required": required,
                "choiceQuestion": {
                    "type": "RADIO",
                    "options": [{"value": opt} for opt in q["options"]],
                },
            }
        if q_type == "number":
            return {"required": required, "textQuestion": {"paragraph": False}}
        if q_type == "date":
            return {"required": required, "dateQuestion": {"includeTime": False}}
        return {"required": required, "textQuestion": {"paragraph": q_type == "text" and len(q.get("text", "")) > 50}}
