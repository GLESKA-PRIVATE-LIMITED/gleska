"""Service for conversational employer job creation assistant."""

from datetime import datetime, timezone
from decimal import Decimal
import base64
import binascii
import hashlib
import hmac
import json
import logging
import re
from typing import Any
from uuid import UUID

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import settings
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.job_assistant import (
    JobAssistantCreateRequest,
    JobAssistantMessageRequest,
    JobAssistantResponse,
    JobAssistantState,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the GO LESKA conversational job-creation assistant's interpretation stage.
Understand the employer's latest message in the context of the chronological conversation and authoritative state.
Identify the employer's intent, including providing job details, correcting a previous detail, asking a question,
clarifying ambiguity, changing language, or confirming information. Propose only changes supported by the message
and context. Unmentioned fields must remain null in extracted.

Extract or propose:
- 'title': Job title or role.
- 'headcount_required': Number of workers required as an integer. ONLY set this when workers, people, or staff count is explicitly mentioned.
- 'max_daily_salary': Offered daily wage per worker in INR as a float/number.
- 'min_experience': Minimum years of experience as a number; convert month expressions to fractional years (for example, six months is 0.5 years) so the backend can validate them.
- 'work_duration_months': Work duration expressed in months when the employer used months; the backend converts this using 30 days per month.
- 'work_duration_days': Total number of working days required as an integer only when the employer expressed the duration in days or weeks.
- 'work_timing': Daily shift hours as a normalized string.
- 'required_skills': List of specific skills mentioned.
- 'site_mention': Any site name or location keyword mentioned.

CRITICAL RULES:
1. Assign numeric values only when their meaning is established by the message and conversation context. Keep duration, daily timing, wage, experience, and headcount distinct. Preserve duration units: use work_duration_months for months and work_duration_days for days or weeks; never convert months to days yourself.
2. If a value remains genuinely ambiguous, add an ambiguous input, leave the affected extracted field null, and do not guess.
3. If a value clearly violates the backend constraints, add an invalid input and do not normalize it as valid.
4. For corrections, set is_correction and return only fields changed in the latest message so the server preserves unrelated state.
5. Do not invent IDs, sites, coordinates, employer facts, or job-creation results.
6. Return ONLY a JSON object matching the requested schema.
"""

RESPONSE_SYSTEM_PROMPT = """You are the final response stage of the GO LESKA employer job assistant.
Write one concise, natural response in the selected language. The authoritative merged state and validation result
below are already decided by the server. Do not mention extraction, Gemini, backend validation, internal fields,
UUIDs, missing_fields, or implementation details. Acknowledge meaningful changes, answer an employer question when
one was asked, ask only for information that is genuinely needed, and do not claim a job was created.
Use fields_changed_this_turn as the primary context for what the employer just supplied or corrected: acknowledge
those changes naturally before asking for anything else. Ask only for information that is still genuinely missing;
never repeat a missing field request merely because it remains missing when the employer is currently providing a
different valid field. If exactly one required field remains missing, you may ask for it while still acknowledging
the latest update. If multiple fields remain missing, ask naturally for one useful next piece of information.
When validation results report an invalid value, explain that supplied value and the validation failure, even if the
field is also listed as missing after the invalid value was rejected; do not replace that explanation with a generic
missing-field question. For example, if minimum experience is invalid or less than 1 year, explain that the minimum experience must be at least 1 year and ask how much experience should be required, rather than asking a generic "what is the minimum experience" question. Do not say everything is complete unless all required fields are valid. Do not behave like a
fixed questionnaire, invent values, alter authoritative state, or ask for fields already present in that state.
"""

LANGUAGE_NAMES = {"EN": "English", "HI": "Hindi", "MR": "Marathi", "TA": "Tamil", "HINGLISH": "natural Hinglish"}

MESSAGES = {
    "EN": {
        "workers_invalid": "The number of workers must be at least 1. How many workers do you need?",
        "duration_invalid": "The work duration must be at least 1 day. How many days will the workers be required?",
        "wage_invalid": "The daily wage must be greater than ₹0. Please provide the daily wage per worker.",
        "timing_invalid": "That doesn't look like a valid working time. Please provide the daily working hours, for example 8 AM to 5 PM.",
        "experience_invalid": "The minimum experience needs to be at least 1 year. How much experience should I require?",
        "title": "What type of work or role do you need workers for?",
        "workers": "How many workers do you need for this job?",
        "site": "Please select or add a work site so we know the job location.",
        "duration": "How many days will the workers be required to work?",
        "wage": "What daily wage (in ₹) would you like to offer per worker?",
        "timing": "Please provide the exact daily working hours, for example 8 AM to 5 PM.",
        "complete": "Everything looks complete! Please review the job preview and click 'Create Job' to publish it.",
    },
    "HI": {
        "workers_invalid": "कामगारों की संख्या कम से कम 1 होनी चाहिए। कृपया सही संख्या बताएं।",
        "duration_invalid": "काम की अवधि कम से कम 1 दिन होनी चाहिए। कामगारों की आवश्यकता कितने दिनों के लिए है?",
        "wage_invalid": "दैनिक वेतन ₹0 से अधिक होना चाहिए। कृपया प्रति कामगार दैनिक वेतन बताएं।",
        "timing_invalid": "काम का समय सही नहीं लगता। कृपया रोज़ाना काम का समय बताएं, जैसे सुबह 8 बजे से शाम 5 बजे तक।",
        "experience_invalid": "न्यूनतम अनुभव कम से कम 1 वर्ष होना चाहिए। आप कितना अनुभव आवश्यक रखना चाहते हैं?",
        "title": "आपको किस प्रकार के काम या भूमिका के लिए कामगार चाहिए?",
        "workers": "आपको कितने कामगार चाहिए?",
        "site": "कृपया काम का स्थान चुनें या जोड़ें।",
        "duration": "कामगारों की आवश्यकता कितने दिनों के लिए है?",
        "wage": "आप प्रति कामगार कितना दैनिक वेतन देना चाहते हैं?",
        "timing": "काम के रोज़ाना समय क्या होंगे? उदाहरण के लिए, सुबह 8 बजे से शाम 5 बजे तक।",
        "complete": "सारी जानकारी पूरी है। कृपया नौकरी का विवरण देखें और नौकरी बनाने के लिए 'नौकरी बनाएं' पर क्लिक करें।",
    },
    "MR": {
        "workers_invalid": "कामगारांची संख्या किमान 1 असावी. कृपया योग्य संख्या सांगा.",
        "duration_invalid": "कामाचा कालावधी किमान 1 दिवस असावा. कामगार किती दिवसांसाठी हवे आहेत?",
        "wage_invalid": "दैनिक वेतन ₹0 पेक्षा जास्त असावे. कृपया प्रत्येक कामगाराचे दैनिक वेतन सांगा.",
        "timing_invalid": "कामाची वेळ योग्य वाटत नाही. कृपया रोजची कामाची वेळ सांगा, उदाहरणार्थ सकाळी 8 ते संध्याकाळी 5.",
        "experience_invalid": "किमान अनुभव कमीत कमी 1 वर्ष असावा लागतो. तुम्ही किती अनुभव आवश्यक ठेवू इच्छिता?",
        "title": "तुम्हाला कोणत्या प्रकारच्या कामासाठी किंवा भूमिकेसाठी कामगार हवे आहेत?",
        "workers": "तुम्हाला किती कामगार हवे आहेत?",
        "site": "कृपया कामाचे ठिकाण निवडा किंवा जोडा.",
        "duration": "कामगार किती दिवसांसाठी हवे आहेत?",
        "wage": "प्रत्येक कामगाराला तुम्ही किती दैनिक वेतन देऊ इच्छिता?",
        "timing": "दररोजची कामाची वेळ काय असेल? उदाहरणार्थ, सकाळी 8 ते संध्याकाळी 5.",
        "complete": "सर्व माहिती पूर्ण आहे. कृपया नोकरीचा तपशील पाहा आणि नोकरी तयार करण्यासाठी 'नोकरी तयार करा' वर क्लिक करा.",
    },
    "TA": {
        "workers_invalid": "தொழிலாளர்களின் எண்ணிக்கை குறைந்தது 1 ஆக இருக்க வேண்டும். சரியான எண்ணிக்கையைச் சொல்லுங்கள்.",
        "duration_invalid": "வேலை காலம் குறைந்தது 1 நாளாக இருக்க வேண்டும். தொழிலாளர்கள் எத்தனை நாட்களுக்கு தேவை?",
        "wage_invalid": "தினசரி ஊதியம் ₹0-க்கு அதிகமாக இருக்க வேண்டும். ஒரு தொழிலாளருக்கான தினசரி ஊதியத்தைச் சொல்லுங்கள்.",
        "timing_invalid": "வேலை நேரம் சரியாகத் தெரியவில்லை. தினசரி வேலை நேரத்தைச் சொல்லுங்கள், உதாரணமாக காலை 8 முதல் மாலை 5 வரை.",
        "experience_invalid": "குறைந்தபட்ச அனுபவம் குறைந்தது 1 ஆண்டாக இருக்க வேண்டும். எவ்வளவு அனுபவம் தேவைப்பட வேண்டும்?",
        "title": "எந்த வகையான வேலை அல்லது பணிக்கு தொழிலாளர்கள் தேவை?",
        "workers": "உங்களுக்கு எத்தனை தொழிலாளர்கள் தேவை?",
        "site": "வேலை நடைபெறும் இடத்தைத் தேர்ந்தெடுக்கவும் அல்லது சேர்க்கவும்.",
        "duration": "தொழிலாளர்கள் எத்தனை நாட்களுக்கு தேவை?",
        "wage": "ஒரு தொழிலாளருக்கு எவ்வளவு தினசரி ஊதியம் வழங்க விரும்புகிறீர்கள்?",
        "timing": "தினசரி வேலை நேரம் என்ன? உதாரணமாக, காலை 8 மணி முதல் மாலை 5 மணி வரை.",
        "complete": "அனைத்து தகவல்களும் முடிந்துவிட்டன. வேலை விவரத்தைப் பார்த்து, வேலை உருவாக்க 'வேலை உருவாக்கு' என்பதைக் கிளிக் செய்யவும்.",
    },
    "HINGLISH": {
        "workers_invalid": "Workers ki sankhya kam se kam 1 honi chahiye. Please sahi number batayein.",
        "duration_invalid": "Work duration kam se kam 1 day honi chahiye. Workers kitne din ke liye chahiye?",
        "wage_invalid": "Daily wage ₹0 se zyada honi chahiye. Per worker daily wage batayein.",
        "timing_invalid": "Working time valid nahi lag raha. Daily timing batayein, jaise subah 8 baje se shaam 5 baje tak.",
        "experience_invalid": "Minimum experience kam se kam 1 year hona chahiye. Aap kitna experience require karna chahte hain?",
        "title": "Aapko kis type ke kaam ya role ke liye workers chahiye?",
        "workers": "Aapko kitne workers chahiye?",
        "site": "Please work site select ya add karein.",
        "duration": "Workers kitne din ke liye chahiye?",
        "wage": "Aap per worker kitni daily wage dena chahenge?",
        "timing": "Daily working hours kya honge? Jaise subah 8 baje se shaam 5 baje tak.",
        "complete": "Saari information complete hai. Job preview check karke job banane ke liye 'Job Banayein' par click karein.",
    },
}


class _GeminiInvalidInput(BaseModel):
    field: str
    raw_value: str


class _GeminiAmbiguousInput(BaseModel):
    field: str
    note: str


class _GeminiExtraction(BaseModel):
    title: str | None = None
    headcount_required: int | None = None
    max_daily_salary: float | None = None
    min_experience: float | None = None
    work_duration_days: int | None = None
    work_duration_months: float | None = None
    work_timing: str | None = None
    required_skills: list[str] = Field(default_factory=list)
    site_mention: str | None = None


class _GeminiInterpretation(BaseModel):
    intent: str = "job_update"
    user_question: bool = False
    extracted: _GeminiExtraction
    invalid_raw_inputs: list[_GeminiInvalidInput] = Field(default_factory=list)
    ambiguous_inputs: list[_GeminiAmbiguousInput] = Field(default_factory=list)
    is_correction: bool = False


class _GeminiFinalResponse(BaseModel):
    assistant_message: str = Field(min_length=1, max_length=2000)


class JobAssistantService:
    """Manages multi-turn state merging, validation, and conversational messaging."""

    MAX_GEMINI_HISTORY = 12

    @classmethod
    def _recent_history(cls, history: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return history[-cls.MAX_GEMINI_HISTORY:]

    @staticmethod
    def _history_text(history: list[dict[str, Any]]) -> str:
        return "\n".join(
            f"{entry.get('role', 'unknown').upper()}: {entry.get('content', '')}"
            for entry in history
            if isinstance(entry, dict)
        )

    @staticmethod
    def _conversation_row(response: Any) -> dict[str, Any]:
        data = getattr(response, "data", None)
        if isinstance(data, list):
            return data[0] if data else {}
        return data or {}

    @classmethod
    def _load_or_create_conversation(
        cls,
        user: UserResponse,
        employer_id: str,
        request: JobAssistantMessageRequest,
    ) -> tuple[str, JobAssistantState, list[dict[str, Any]]]:
        if request.conversation_id:
            response = (
                supabase.table("assistant_conversations")
                .select("id, user_id, employer_id, structured_state, history, language, status")
                .eq("id", request.conversation_id)
                .eq("user_id", user.id)
                .eq("employer_id", employer_id)
                .execute()
            )
            conversation = cls._conversation_row(response)
            if not conversation:
                raise ValueError("CONVERSATION_NOT_FOUND")
            if conversation.get("status") != "ACTIVE":
                raise ValueError("CONVERSATION_NOT_ACTIVE")
            state = JobAssistantState.model_validate(conversation.get("structured_state") or {})
            history = conversation.get("history") or []
            if not isinstance(history, list):
                raise ValueError("CONVERSATION_HISTORY_INVALID")
            return str(conversation["id"]), state, history

        response = supabase.table("assistant_conversations").insert({
            "user_id": user.id,
            "employer_id": employer_id,
            "structured_state": JobAssistantState().model_dump(mode="json"),
            "history": [],
            "language": request.language,
            "status": "ACTIVE",
        }).execute()
        conversation = cls._conversation_row(response)
        if not conversation.get("id"):
            raise ValueError("CONVERSATION_CREATE_FAILED")
        return str(conversation["id"]), JobAssistantState(), []

    @classmethod
    def _persist_conversation(
        cls,
        user: UserResponse,
        conversation_id: str,
        employer_id: str,
        state: JobAssistantState,
        history: list[dict[str, Any]],
        language: str,
    ) -> None:
        response = (
            supabase.table("assistant_conversations")
            .update({
                "structured_state": state.model_dump(mode="json"),
                "history": history,
                "language": language,
            })
            .eq("id", conversation_id)
            .eq("user_id", user.id)
            .eq("employer_id", employer_id)
            .execute()
        )
        if not getattr(response, "data", None):
            raise ValueError("CONVERSATION_NOT_FOUND")

    @staticmethod
    def _confirmation_token(user: UserResponse, conversation_id: str, state: JobAssistantState) -> str:
        payload = json.dumps(
            {
                "user_id": user.id,
                "conversation_id": conversation_id,
                "issued_at": int(datetime.now(timezone.utc).timestamp()),
                "state": state.model_dump(mode="json"),
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        signature = hmac.new(settings.JWT_SECRET_KEY.encode(), payload, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(payload + b"." + signature).decode()

    @staticmethod
    def _state_from_confirmation(user: UserResponse, request: JobAssistantCreateRequest) -> JobAssistantState:
        try:
            encoded_payload, encoded_signature = base64.urlsafe_b64decode(request.confirmation_token.encode()).rsplit(b".", 1)
            expected = hmac.new(settings.JWT_SECRET_KEY.encode(), encoded_payload, hashlib.sha256).digest()
            if not hmac.compare_digest(encoded_signature, expected):
                raise ValueError("INVALID_CONFIRMATION")
            payload = json.loads(encoded_payload)
            if payload.get("user_id") != user.id or payload.get("conversation_id") != request.conversation_id:
                raise ValueError("INVALID_CONFIRMATION")
            issued_at = int(payload.get("issued_at", 0))
            if issued_at <= 0 or datetime.now(timezone.utc).timestamp() - issued_at > 600:
                raise ValueError("INVALID_CONFIRMATION")
            return JobAssistantState.model_validate(payload["state"])
        except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError, binascii.Error):
            raise ValueError("INVALID_CONFIRMATION") from None

    @classmethod
    def create_confirmed_job(cls, user: UserResponse, request: JobAssistantCreateRequest):
        from app.services.job_service import JobService

        state = cls._state_from_confirmation(user, request)
        conversation_response = (
            supabase.table("assistant_conversations")
            .select("structured_state, status")
            .eq("id", request.conversation_id)
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        conversation = cls._conversation_row(conversation_response)
        persisted_state = JobAssistantState.model_validate(conversation.get("structured_state") or {}) if conversation else None
        if not conversation or conversation.get("status") != "ACTIVE" or persisted_state != state:
            raise ValueError("INVALID_CONFIRMATION")
        try:
            job_request = cls._job_create_from_state(state)
        except (ValueError, ValidationError):
            raise ValueError("ASSISTANT_NOT_READY")
        return JobService.create(user, job_request)

    @staticmethod
    def _job_create_from_state(state: JobAssistantState):
        from decimal import Decimal
        from uuid import UUID
        from app.schemas.job import JobCreate

        if (
            not state.job_site_id
            or not state.title
            or state.headcount_required is None
            or state.max_daily_salary is None
            or state.work_duration_days is None
            or not state.work_timing
            or state.min_experience is None
            or state.min_experience < 1
            or not state.required_skills
        ):
            raise ValueError("ASSISTANT_NOT_READY")
        return JobCreate(
            job_site_id=UUID(state.job_site_id),
            title=state.title,
            headcount_required=state.headcount_required,
            max_daily_salary=Decimal(str(state.max_daily_salary)),
            min_experience=state.min_experience,
            work_duration_days=state.work_duration_days,
            work_timing=state.work_timing,
            required_skills=state.required_skills,
        )

    @staticmethod
    def _gemini_schema() -> dict[str, Any]:
        return {
            "type": "OBJECT",
            "properties": {
                "intent": {"type": "STRING"},
                "user_question": {"type": "BOOLEAN"},
                "extracted": {
                    "type": "OBJECT",
                    "properties": {
                        "title": {"type": "STRING", "nullable": True},
                        "headcount_required": {"type": "INTEGER", "nullable": True},
                        "max_daily_salary": {"type": "NUMBER", "nullable": True},
                        "min_experience": {"type": "NUMBER", "nullable": True},
                        "work_duration_days": {"type": "INTEGER", "nullable": True},
                        "work_duration_months": {"type": "NUMBER", "nullable": True},
                        "work_timing": {"type": "STRING", "nullable": True},
                        "required_skills": {"type": "ARRAY", "items": {"type": "STRING"}},
                        "site_mention": {"type": "STRING", "nullable": True},
                    },
                    "required": ["required_skills"],
                },
                "invalid_raw_inputs": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "field": {"type": "STRING"},
                            "raw_value": {"type": "STRING"},
                        },
                        "required": ["field", "raw_value"],
                    },
                },
                "ambiguous_inputs": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "field": {"type": "STRING"},
                            "note": {"type": "STRING"},
                        },
                        "required": ["field", "note"],
                    },
                },
                "is_correction": {"type": "BOOLEAN"},
            },
            "required": ["intent", "user_question", "extracted", "invalid_raw_inputs", "ambiguous_inputs", "is_correction"],
        }

    @classmethod
    async def _call_gemini(
        cls,
        message: str,
        current_state: JobAssistantState,
        language: str,
        history: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Calls Gemini to interpret user message in context of current state."""
        api_key = settings.GEMINI_API_KEY.strip()
        model = settings.GEMINI_MODEL.strip()
        if not api_key or not model:
            return cls._fallback_rule_extractor(message, current_state, language, history)

        user_content = (
            f"Selected conversation language: {LANGUAGE_NAMES[language]}\n"
            f"Chronological recent conversation:\n{cls._history_text(cls._recent_history(history))}\n\n"
            f"Currently known state:\n{current_state.model_dump_json(exclude_none=True)}\n\n"
            f"Latest employer message:\n\"{message}\""
        )
        payload = {
            "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": user_content}]}],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
                "responseSchema": cls._gemini_schema(),
            },
        }
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            async with httpx.AsyncClient(timeout=settings.GEMINI_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    endpoint,
                    headers={"x-goog-api-key": api_key, "content-type": "application/json"},
                    json=payload,
                )
            if response.status_code == 200:
                body = response.json()
                raw_text = body["candidates"][0]["content"]["parts"][0]["text"]
                parsed = _GeminiInterpretation.model_validate(json.loads(raw_text))
                result = parsed.model_dump()
                result["_source"] = "gemini"
                logger.info("Assistant interpretation succeeded: language=%s", language)
                return result
            logger.warning("Gemini assistant interpretation returned status %s; using fallback extractor", response.status_code)
        except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValidationError) as exc:
            logger.warning("Gemini assistant returned malformed output (%s), using fallback extractor", exc)
        except Exception as exc:
            logger.warning("Gemini assistant call failed (%s), using fallback extractor", exc)

        result = cls._fallback_rule_extractor(message, current_state, language, history)
        result["_source"] = "fallback"
        return result

    @classmethod
    async def _call_final_gemini(
        cls,
        message: str,
        state: JobAssistantState,
        history: list[dict[str, Any]],
        language: str,
        updated_fields: list[str],
        missing_fields: list[str],
        validation_errors: list[str],
        ambiguity_notes: list[str],
        owned_sites: list[dict[str, Any]],
    ) -> str | None:
        api_key = settings.GEMINI_API_KEY.strip()
        model = settings.GEMINI_MODEL.strip()
        if not api_key or not model:
            return None

        site_context = [
            {"id": str(site.get("id")), "name": site.get("name"), "address": site.get("address")}
            for site in owned_sites
        ]
        prompt = (
            f"Selected language: {LANGUAGE_NAMES[language]}\n"
            f"Recent conversation:\n{cls._history_text(cls._recent_history(history))}\n\n"
            f"Latest employer message: {message}\n"
            f"Authoritative merged state: {state.model_dump_json(exclude_none=True)}\n"
            f"fields_changed_this_turn: {json.dumps(updated_fields)}\n"
            f"Missing required information (status only): {json.dumps(missing_fields)}\n"
            f"Ready to create: {not missing_fields and not validation_errors}\n"
            f"Validation results: {json.dumps(validation_errors)}\n"
            f"Ambiguities: {json.dumps(ambiguity_notes)}\n"
            f"Owned site context: {json.dumps(site_context)}"
        )
        payload = {
            "system_instruction": {"parts": [{"text": RESPONSE_SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.3,
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {"assistant_message": {"type": "STRING"}},
                    "required": ["assistant_message"],
                },
            },
        }
        logger.info(
            "Assistant final request: latest_user_message=%s fields_changed_this_turn=%s authoritative_state=%s missing_fields=%s readiness=%s validation_errors=%s ambiguities=%s payload=%s",
            message,
            updated_fields,
            state.model_dump(mode="json"),
            missing_fields,
            not missing_fields and not validation_errors,
            validation_errors,
            ambiguity_notes,
            payload,
        )
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            async with httpx.AsyncClient(timeout=settings.GEMINI_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    endpoint,
                    headers={"x-goog-api-key": api_key, "content-type": "application/json"},
                    json=payload,
                )
            body = response.json() if response.status_code == 200 else {}
            raw_text = body["candidates"][0]["content"]["parts"][0]["text"]
            final = _GeminiFinalResponse.model_validate(json.loads(raw_text))
            logger.info("Assistant final response succeeded: language=%s response=%s", language, final.assistant_message)
            return final.assistant_message.strip()
        except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValidationError) as exc:
            logger.warning("Gemini final response was malformed; using safe fallback: %s", exc)
        except Exception as exc:
            logger.warning("Gemini final response failed; using safe fallback: %s", exc)
        return None

    @staticmethod
    def _number_from_phrase(value: str | None) -> int | float | None:
        if value is None:
            return None
        text = " ".join(value.lower().replace("₹", " ").replace("rs", " ").split())
        if not text:
            return None

        num_words = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                     "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
                     "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
                     "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
                     "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40,
                     "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
                     "ek": 1, "do": 2, "teen": 3, "char": 4, "paanch": 5, "chhe": 6,
                     "saat": 7, "aath": 8, "nau": 9, "das": 10, "gyarah": 11, "barah": 12,
                     "terah": 13, "chaudah": 14, "pandrah": 15, "solah": 16, "satrah": 17,
                     "atharah": 18, "unnis": 19, "bees": 20}

        if re.fullmatch(r"(?:\d+|" + "|".join(sorted(num_words.keys(), key=len, reverse=True)) + r")\s+hundred\b", text):
            base_raw = re.match(r"^(?:\d+|" + "|".join(sorted(num_words.keys(), key=len, reverse=True)) + r")", text)
            if not base_raw:
                return None
            base_value = base_raw.group(0)
            base_num = int(base_value) if base_value.isdigit() else num_words.get(base_value)
            if base_num is not None:
                return base_num * 100

        if re.fullmatch(r"\d+(?:\.\d+)?", text):
            return float(text) if "." in text else int(text)

        hundred_match = re.search(r"(\d+)\s*hundred", text)
        if hundred_match:
            return int(hundred_match.group(1)) * 100

        hundred_word_match = re.search(r"(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+hundred\b", text)
        if hundred_word_match:
            base = hundred_word_match.group(1)
            return num_words.get(base, 0) * 100

        words_match = re.search(r"(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s*(?:hundred)?", text)
        if words_match:
            raw = words_match.group(1)
            if re.fullmatch(r"\d+(?:\.\d+)?", raw):
                return float(raw) if "." in raw else int(raw)
            return num_words.get(raw)

        tokens = text.replace("-", " ").split()
        total = 0
        for word in tokens:
            if word in {"and", "of", "for", "about", "almost", "around", "roughly", "nearly", "year", "years", "month", "months", "day", "days", "worker", "workers", "people", "person", "staff", "cooks", "cook"}:
                continue
            if word in num_words:
                total += num_words[word]
            elif word == "hundred":
                total *= 100
            else:
                return None
        return total if total > 0 else None

    @staticmethod
    def _infer_required_skills(message: str) -> list[str]:
        lower = message.lower()
        skills: list[str] = []
        if "south indian" in lower:
            skills.append("South Indian cooking")
        if "north indian" in lower:
            skills.append("North Indian cooking")
        if "breakfast" in lower:
            skills.append("Breakfast preparation")
        if "kitchen cleaning" in lower or "kitchen clean" in lower or "cleaning" in lower:
            skills.append("Kitchen cleaning")
        if "food preparation" in lower or "cook" in lower:
            if "breakfast" in lower:
                skills.append("Breakfast preparation")
        if "cooking" in lower and "south indian" not in lower and "north indian" not in lower:
            skills.append("Cooking")
        return skills

    @staticmethod
    def _normalize_timing_expression(value: str | None) -> str | None:
        if not value:
            return None
        text = " ".join(value.lower().split())

        replacements = {
            "in the morning": "morning",
            "in the evening": "evening",
            "subah": "morning",
            "shaam": "evening",
            "sham": "evening",
            "dopahar": "afternoon",
            "do pahar": "afternoon",
            "se": "to",
            "tak": "to",
            "baje": "",
            "kaam hoga": "",
            "kaam": "",
            "hoga": "",
        }
        for old, new in replacements.items():
            text = text.replace(old, new)
        text = " ".join(text.split())

        if re.search(r"\b(?:morning|afternoon|evening|night)\b", text):
            text = text.replace("in the morning", "morning").replace("in the evening", "evening")
            if re.search(r"\bmorning\s*(\d{1,2})\s*(?:to|-|–)\s*(?:evening|night|afternoon)?\s*(\d{1,2})\b", text):
                match = re.search(r"\bmorning\s*(\d{1,2})\s*(?:to|-|–)\s*(?:evening|night|afternoon)?\s*(\d{1,2})\b", text)
                start = int(match.group(1))
                end = int(match.group(2))
                return f"{start}:00 AM to {end}:00 PM"
            if re.search(r"\bmorning\s*(\d{1,2})\s*(?:to|-|–)\s*(\d{1,2})\b", text):
                match = re.search(r"\bmorning\s*(\d{1,2})\s*(?:to|-|–)\s*(\d{1,2})\b", text)
                start = int(match.group(1))
                end = int(match.group(2))
                return f"{start}:00 AM to {end}:00 AM"
            if re.search(r"\bafternoon\s*(\d{1,2})\s*(?:to|-|–)\s*(?:evening|night)?\s*(\d{1,2})\b", text):
                match = re.search(r"\bafternoon\s*(\d{1,2})\s*(?:to|-|–)\s*(?:evening|night)?\s*(\d{1,2})\b", text)
                start = int(match.group(1))
                end = int(match.group(2))
                return f"{start}:00 PM to {end}:00 PM"
        timing_match = re.search(r"(\d{1,2})(?::\d{2})?\s*(am|pm)?\s*(?:to|-|–)\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?", text, re.IGNORECASE)
        if timing_match:
            start_hour = int(timing_match.group(1))
            start_meridiem = (timing_match.group(2) or "AM").upper()
            end_hour = int(timing_match.group(3))
            end_meridiem = (timing_match.group(4) or "PM").upper()
            if start_meridiem == "AM" and end_meridiem == "AM" and end_hour <= start_hour:
                return None
            if start_meridiem == "PM" and end_meridiem == "PM" and end_hour <= start_hour:
                return None
            return f"{start_hour}:00 {start_meridiem} to {end_hour}:00 {end_meridiem}"
        return None

    @staticmethod
    def _contextual_field_from_history(history: list[dict[str, Any]]) -> str | None:
        for entry in reversed(history or []):
            if entry.get("role") != "assistant":
                continue
            content = str(entry.get("content", "")).lower()
            if any(token in content for token in ["daily wage", "wage", "salary", "per worker", "per day"]):
                return "max_daily_salary"
            if any(token in content for token in ["workers do you need", "how many workers", "worker count", "workers needed"]):
                return "headcount_required"
            if any(token in content for token in ["how many days", "required to work", "duration", "for how long"]):
                return "work_duration_days"
            if any(token in content for token in ["daily working hours", "working hours", "timing", "time"]):
                return "work_timing"
            if any(token in content for token in ["experience", "years of experience", "minimum experience"]):
                return "min_experience"
            if any(token in content for token in ["skills", "requirements", "role", "type of work"]):
                return "required_skills"
        return None

    @classmethod
    def _fallback_rule_extractor(
        cls,
        message: str,
        current_state: JobAssistantState,
        language: str = "EN",
        history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Fast, field-aware regex/rule-based parser as a reliable fallback."""
        text = message.strip()
        lower = text.lower()
        extracted: dict[str, Any] = {"required_skills": []}
        invalid_raw_inputs: list[dict[str, str]] = []
        ambiguous_inputs: list[dict[str, str]] = []
        context_field = cls._contextual_field_from_history(history or [])

        amb_match = re.search(r"^(?:i\s+need\s+|need\s+|want\s+|make\s+it\s+|actually\s+)?(\d+)(?:\s+only)?\.?$", lower)
        has_field_keyword = any(kw in lower for kw in [
            "worker", "workers", "people", "person", "helper", "helpers", "cook", "cooks",
            "mason", "masons", "plumber", "plumbers", "electrician", "staff", "labourer", "labourers",
            "day", "days", "month", "months", "week", "weeks",
            "year", "years", "yr", "yrs", "exp", "experience",
            "₹", "rs", "inr", "salary", "wage", "per day", "daily", "/day", "pay",
            "am", "pm", "shift", "timing", "hours"
        ]) or any(kw in lower for kw in ["कामगार", "कुक", "दिन", "दिवस", "வேலை", "தொழிலாளர்", "நாள்"])
        if amb_match and not has_field_keyword and not context_field:
            num = amb_match.group(1)
            ambiguous_inputs.append({
                "field": "ambiguous_number",
                "note": f"Do you mean {num} workers or {num} days?",
            })
            return {
                "extracted": extracted,
                "invalid_raw_inputs": invalid_raw_inputs,
                "ambiguous_inputs": ambiguous_inputs,
                "is_correction": bool(re.search(r"actually|change|make\s+it|update|no|correction", lower)),
            }

        dur_neg = re.search(r"(-\d+)\s*(?:days?|working\s+days?|weeks?|months?)", lower)
        if dur_neg:
            invalid_raw_inputs.append({"field": "work_duration_days", "raw_value": dur_neg.group(1)})
        elif context_field != "min_experience":
            has_experience_context = bool(re.search(r"\b(?:experience|exp|min(?:imum)?|year|years|yr|yrs|mahina|mahine)\b", lower))
            is_duration_request = bool(re.search(r"\b(?:for|duration|ke\s+liye|liye|for\s+|\bneed\b|\bwant\b|\brequire\b)\b", lower))
            month_match = re.search(r"(?:for|duration(?:\s+is)?\s*|ke\s+liye\s*|liye\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|ek|do|teen|char|paanch|chhe|saat|aath|nau|das)\s*(?:months?|mahine|mahina|maah|mahin)\b", lower)
            if month_match and (is_duration_request or not has_experience_context):
                amount = cls._number_from_phrase(month_match.group(1))
                if amount is not None:
                    extracted["work_duration_months"] = amount
            else:
                week_match = re.search(r"(?:for|duration(?:\s+is)?\s*|ke\s+liye\s*|liye\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|paanch|chhe|saat|aath|nau|das)\s*weeks?\b", lower)
                if week_match:
                    amount = cls._number_from_phrase(week_match.group(1))
                    if amount is not None:
                        extracted["work_duration_days"] = amount * 7
                else:
                    day_match = re.search(r"(?:for|duration(?:\s+is)?\s*|ke\s+liye\s*|liye\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|ninety|ek|do|teen|char|paanch|chhe|saat|aath|nau|das)\s*(?:working\s+)?days?\b", lower)
                    if not day_match and language in {"HI", "MR", "TA", "HINGLISH"}:
                        day_match = re.search(r"(\d+|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|paanch|chhe|saat|aath|nau|das)\s*(?:दिनों?|दिवस|நாட்கள்?|நாள்)", lower)
                    if day_match:
                        amount = cls._number_from_phrase(day_match.group(1))
                        if amount is not None:
                            extracted["work_duration_days"] = amount

        exp_neg = re.search(r"(-\d+)\s*(?:years?|yrs?)(?:\s+of)?\s*experience", lower)
        if exp_neg:
            invalid_raw_inputs.append({"field": "min_experience", "raw_value": exp_neg.group(1)})
        else:
            exp_match = (
                re.search(r"(?:min(?:imum)?\s*)?(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(?:\+|plus)?\s*(?:years?|yrs?)(?:\s+of)?\s*experience\b", lower)
                or re.search(r"experience(?:\s+of)?\s*(?:at\s+least\s+|minimum\s+|should\s+be\s+at\s+least\s+)?(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:years?|yrs?)\b", lower)
                or re.search(r"(?:at\s+least\s+|minimum\s+|should\s+be\s+at\s+least\s+)?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:year|years|yr|yrs)\b", lower)
                or re.search(r"(\d+)\s*(?:years?|yrs?)\s+exp\b", lower)
            )
            if exp_match:
                value = exp_match.group(1)
                if value in {"a", "an"}:
                    extracted["min_experience"] = 1
                else:
                    extracted["min_experience"] = cls._number_from_phrase(value)
            else:
                year_month_match = re.search(
                    r"(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|ek|do|teen|char|paanch|chhe|saat|aath|nau|das)\s*(?:years?|yrs?|year)\s*(?:and|,|/|-)?\s*(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|ek|do|teen|char|paanch|chhe|saat|aath|nau|das)\s*(?:months?|mahine|mahina)\b",
                    lower,
                )
                if year_month_match:
                    years = cls._number_from_phrase(year_month_match.group(1))
                    months = cls._number_from_phrase(year_month_match.group(2))
                    if years is not None and months is not None:
                        extracted["min_experience"] = float(years + (months / 12))
                elif re.search(r"\b(?:fresher|freshers|no\s+experience|0\s+years?(?:\s+experience)?)\b", lower):
                    extracted["min_experience"] = 0

            if extracted.get("min_experience") is None and context_field == "min_experience":
                month_experience_match = re.search(
                    r"(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|ek|do|teen|char|paanch|chhe|saat|aath|nau|das)\s*(?:months?|mahine|mahina)\b",
                    lower,
                )
                half_year_match = re.search(r"\bhalf\s+(?:a\s+)?year\b", lower)
                if month_experience_match:
                    amount = cls._number_from_phrase(month_experience_match.group(1))
                    if amount is not None:
                        extracted["min_experience"] = amount / 12
                elif half_year_match:
                    extracted["min_experience"] = 0.5

        worker_neg = re.search(r"(-\d+)\s*(?:workers?|people|persons?|helpers?|cooks?|labourers?|masons?|staff)", lower)
        if worker_neg:
            invalid_raw_inputs.append({"field": "headcount_required", "raw_value": worker_neg.group(1)})
        else:
            worker_match = (
                re.search(r"(?:almost|about|around|roughly|nearly)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(?:(?:south|north)\s+indian\s+)?(?:workers?|people|persons?|helpers?|cooks?|labourers?|masons?|plumbers?|electricians?|carpenters?|painters?|welders?|drivers?|staff)\b", lower)
                or re.search(r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(?:workers?|people|persons?|helpers?|cooks?|labourers?|masons?|plumbers?|electricians?|carpenters?|painters?|welders?|drivers?|staff)\b", lower)
                or re.search(r"(?:need|require|hire|want|headcount(?:\s+of)?|actually\s+(?:need\s+)?|make\s+it)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:workers?|people|persons?|helpers?|staff|labourers?|cooks?|masons?)", lower)
            )
            if not worker_match:
                worker_match = re.search(r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:(?:south|north)\s+indian\s+)?(?:workers?|people|persons?|helpers?|cooks?|labourers?|masons?|plumbers?|electricians?|carpenters?|painters?|welders?|drivers?|staff)\b", lower)
            if not worker_match and language in {"HI", "MR", "TA", "HINGLISH"}:
                worker_match = re.search(r"(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:कामगार|कुक|श्रमिक|தொழிலாளர்கள்?|சமையல்காரர்கள்?)", lower)
            if not worker_match:
                worker_match = re.search(
                    r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:\w+\s+){1,3}(?:workers?|people|persons?|helpers?|cooks?|staff|labourers?|masons?)\b",
                    lower,
                )
            if worker_match:
                extracted["headcount_required"] = cls._number_from_phrase(worker_match.group(1))

        if not extracted.get("headcount_required") and context_field == "headcount_required":
            count_match = re.fullmatch(
                r"(?:actually\s+|change\s+(?:the\s+)?count\s+to\s+|make\s+it\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*\.?",
                lower,
            )
            if count_match:
                extracted["headcount_required"] = cls._number_from_phrase(count_match.group(1))

        wage_neg = re.search(r"(?:₹|rs\.?|inr|salary|wage)?\s*(-\d+)\s*(?:per\s+day|daily|/day)?", lower)
        if wage_neg and int(wage_neg.group(1)) <= 0:
            invalid_raw_inputs.append({"field": "max_daily_salary", "raw_value": wage_neg.group(1)})
        else:
            wage_match = (
                re.search(r"(?:₹|rs\.?|inr|salary|wage|pay(?:ing)?)\s*[:=]?\s*(\d+\s*hundred|\d+|five\s+hundred|six\s+hundred|seven\s+hundred|eight\s+hundred|nine\s+hundred|one\s+hundred|two\s+hundred|three\s+hundred|four\s+hundred)", lower)
                or re.search(r"^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+hundred\b", lower)
                or re.search(r"((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\s+hundred)?)\s*(?:per\s+day|daily|per\s+diem|/day)\b", lower)
                or re.search(r"(?:₹|rs\.?|inr|salary|wage|pay(?:ing)?)\s*[:=]?\s*(\d+)", lower)
                or re.search(r"^(\d+|five|six|seven|eight|nine|one|two|three|four|ten|twelve|twenty)\s*\.?$", lower)
            )
            if wage_match:
                raw_value = wage_match.group(1) if wage_match.lastindex else wage_match.group(0)
                val = cls._number_from_phrase(raw_value)
                if val is None and raw_value.isdigit():
                    val = int(raw_value)
                if val is not None:
                    if val <= 0:
                        invalid_raw_inputs.append({"field": "max_daily_salary", "raw_value": str(val)})
                    else:
                        extracted["max_daily_salary"] = float(val)

        if context_field == "max_daily_salary" and extracted.get("max_daily_salary") is None:
            amount = cls._number_from_phrase(text)
            if amount is not None:
                extracted["max_daily_salary"] = float(amount)

        timing_candidate = cls._normalize_timing_expression(lower)
        if "morning shift" in lower or "night shift" in lower or "evening shift" in lower:
            ambiguous_inputs.append({"field": "work_timing", "note": "Shift name specified without exact hours"})
        elif timing_candidate:
            extracted["work_timing"] = timing_candidate
        elif re.search(r"(?:timing|hours|shift)", lower) and re.search(r"\d{2,4}\s*(?:am|pm)?\s*(?:to|-|–)\s*\d{1,4}\s*(?:am|pm)?", lower):
            raw_t = re.search(r"\d{1,4}\s*(?:am|pm)?\s*(?:to|-|–)\s*\d{1,4}\s*(?:am|pm)?", lower).group(0)
            invalid_raw_inputs.append({"field": "work_timing", "raw_value": raw_t})
        else:
            timing_match = re.search(r"(\d{1,4}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-|–)\s*\d{1,4}(?::\d{2})?\s*(?:am|pm)?)", lower)
            if timing_match:
                candidate_str = timing_match.group(1)
                is_valid, _ = cls._validate_timing(candidate_str)
                if not is_valid:
                    invalid_raw_inputs.append({"field": "work_timing", "raw_value": candidate_str})
                else:
                    extracted["work_timing"] = candidate_str.upper()

        for role in ["cook", "chef", "mason", "plumber", "electrician", "carpenter", "welder", "painter", "driver", "security guard", "helper", "cleaner", "construction worker", "labourer"]:
            if re.search(rf"\b{role}s?\b", lower):
                extracted["title"] = role.title()
                break
        if not extracted.get("title"):
            if re.search(r"कुक|रसोइया|சமையல்கார", lower):
                extracted["title"] = "Cook"
            elif re.search(r"स्वयंपाकी|स्वयंपाक", lower):
                extracted["title"] = "Cook"

        skill_phrases = cls._infer_required_skills(message)
        for skill in skill_phrases:
            if skill.casefold() not in {item.casefold() for item in extracted["required_skills"]}:
                extracted["required_skills"].append(skill)

        skill_match = re.search(r"(?:skills?|कौशल|कौशल्य)\s*[:\-]?\s*(.+?)(?:\.|$)", text, re.IGNORECASE)
        if skill_match:
            for skill in re.split(r",|\band\b|\bor\b|\s+और\s+|\s+आणि\s+", skill_match.group(1), flags=re.IGNORECASE):
                normalized_skill = " ".join(skill.strip().split())
                if normalized_skill and normalized_skill.casefold() not in {item.casefold() for item in extracted["required_skills"]}:
                    extracted["required_skills"].append(normalized_skill)

        site_match = re.search(r"(?:at|in|for)\s+([a-zA-Z0-9'\s]+?)\s+(?:site|hotel|plant|branch|location|office)\b", lower)
        if site_match:
            extracted["site_mention"] = site_match.group(1).strip()

        return {
            "extracted": extracted,
            "invalid_raw_inputs": invalid_raw_inputs,
            "ambiguous_inputs": ambiguous_inputs,
            "is_correction": bool(re.search(r"actually|change|make\s+it|update|no|correction", lower)),
        }

    @staticmethod
    def _validate_timing(timing_str: str | None) -> tuple[bool, str | None]:
        """Validates working hours string format (e.g., '8 AM to 5 PM', '9:00 AM - 6:00 PM')."""
        if not timing_str:
            return False, None
        normalized = " ".join(timing_str.split())
        # Check for obvious nonsense values like '90 AM to 200 PM'
        time_tokens = re.findall(r"(\d{1,3})(?::(\d{1,2}))?\s*(am|pm)?", normalized, re.IGNORECASE)
        if len(time_tokens) >= 2:
            for hours, mins, _ in time_tokens[:2]:
                h = int(hours)
                m = int(mins) if mins else 0
                if h > 24 or (h > 12 and any(t[2] for t in time_tokens)) or m > 59:
                    return False, None
            return True, normalized
        if re.search(r"\d{1,2}\s*(?:am|pm)?\s*(?:to|-|–)\s*\d{1,2}\s*(?:am|pm)?", normalized, re.IGNORECASE):
            return True, normalized
        return False, None

    @classmethod
    async def process_message(
        cls,
        user: UserResponse,
        request: JobAssistantMessageRequest,
    ) -> JobAssistantResponse:
        """Processes a single conversational turn with full server-side validation."""
        # Retrieve employer profile & owned job sites
        employer_res = (
            supabase.table("employer_profiles")
            .select("id, onboarding_status")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        employer = employer_res.data or {}
        if not employer.get("id"):
            raise ValueError("EMPLOYER_NOT_FOUND")
        employer_id = str(employer["id"])

        conversation_id, server_state, history = cls._load_or_create_conversation(user, employer_id, request)
        now = datetime.now(timezone.utc).isoformat()
        history = [*history, {"role": "user", "content": request.message, "created_at": now}]

        owned_sites_res = (
            supabase.table("job_sites")
            .select("id, name, address")
            .eq("employer_id", employer_id)
            .execute()
        )
        owned_sites_raw = owned_sites_res.data or []
        if isinstance(owned_sites_raw, dict):
            owned_sites = [owned_sites_raw] if owned_sites_raw else []
        else:
            owned_sites = owned_sites_raw
        owned_site_map = {str(site["id"]): site for site in owned_sites if isinstance(site, dict) and "id" in site}

        # Interpret user message via Gemini (or fallback)
        gemini_result = await cls._call_gemini(request.message, server_state, request.language, history)
        extracted = gemini_result.get("extracted") or {}
        invalid_raw = gemini_result.get("invalid_raw_inputs") or []
        ambiguous = gemini_result.get("ambiguous_inputs") or []
        is_correction = gemini_result.get("is_correction", False)
        interpretation_source = gemini_result.get("_source", "fallback")
        logger.info(
            "Assistant interpretation: source=%s extracted=%s invalid_raw_inputs=%s ambiguous_inputs=%s server_state=%s",
            interpretation_source,
            extracted,
            invalid_raw,
            ambiguous,
            server_state.model_dump(mode="json"),
        )

        # The persisted conversation state is authoritative; client current_state is compatibility-only.
        state = server_state.model_copy()
        messages = MESSAGES[request.language]
        validation_errors: list[str] = []
        updated_fields: list[str] = []

        # 1. Immediate validation of explicitly invalid inputs
        for inv in invalid_raw:
            field = inv.get("field")
            raw_val = inv.get("raw_value")
            if field == "headcount_required":
                validation_errors.append(messages["workers_invalid"])
                state.headcount_required = None
            elif field == "work_duration_days":
                validation_errors.append(messages["duration_invalid"])
                state.work_duration_days = None
            elif field == "max_daily_salary":
                validation_errors.append(messages["wage_invalid"])
                state.max_daily_salary = None
            elif field == "work_timing":
                validation_errors.append(messages["timing_invalid"])
                state.work_timing = None
            elif field == "min_experience":
                validation_errors.append(messages["experience_invalid"])
                state.min_experience = None

        # 2. Check ambiguous inputs
        for amb in ambiguous:
            field = amb.get("field")
            note = amb.get("note")
            if field == "ambiguous_number":
                validation_errors.append(messages["workers"] + " या " + messages["duration"] if request.language == "HI" else messages["workers"] if request.language != "EN" else note or "Do you mean workers or days?")
            elif field == "work_timing":
                validation_errors.append(messages["timing"])
                state.work_timing = None
            elif field == "work_duration_days":
                validation_errors.append(messages["duration"])
                state.work_duration_days = None
            elif field == "max_daily_salary":
                validation_errors.append(messages["wage"])
                state.max_daily_salary = None

        # 3. Server-side validation and merging of candidate extracted fields
        # Headcount (Only update if headcount_required is explicitly extracted and valid)
        hc = extracted.get("headcount_required")
        if hc is not None:
            if hc <= 0:
                if not any("workers must be at least 1" in e for e in validation_errors):
                    validation_errors.append(messages["workers_invalid"])
                state.headcount_required = None
            elif hc > 1000:
                validation_errors.append(messages["workers_invalid"])
                state.headcount_required = None
            else:
                if state.headcount_required != hc:
                    state.headcount_required = hc
                    updated_fields.append(f"{hc} workers")

        # Work Duration: normalize model-proposed units through the backend business rule.
        duration_months = extracted.get("work_duration_months")
        dur = extracted.get("work_duration_days")
        if duration_months is not None:
            if duration_months <= 0:
                validation_errors.append(messages["duration_invalid"])
                dur = None
            else:
                dur = int(duration_months * 30)
        if dur is not None:
            if dur <= 0:
                if not any("duration must be at least 1 day" in e for e in validation_errors):
                    validation_errors.append(messages["duration_invalid"])
                state.work_duration_days = None
            elif dur > 365:
                validation_errors.append(messages["duration_invalid"])
                state.work_duration_days = None
            else:
                if state.work_duration_days != dur:
                    state.work_duration_days = dur
                    updated_fields.append(f"{dur} days duration")
                state.work_duration_months = Decimal(str(duration_months)) if duration_months is not None else None

        # Daily Salary
        sal = extracted.get("max_daily_salary")
        if sal is not None:
            if sal <= 0:
                if not any("greater than ₹0" in e for e in validation_errors):
                    validation_errors.append(messages["wage_invalid"])
                state.max_daily_salary = None
            elif sal > 1_000_000:
                validation_errors.append(messages["wage_invalid"])
                state.max_daily_salary = None
            else:
                if state.max_daily_salary != sal:
                    state.max_daily_salary = sal
                    updated_fields.append(f"₹{int(sal)}/day wage")

        # Work Timing
        wt = extracted.get("work_timing")
        if wt:
            is_valid, normalized_wt = cls._validate_timing(wt)
            if not is_valid:
                if not any("valid working time" in e for e in validation_errors):
                    validation_errors.append(messages["timing_invalid"])
                state.work_timing = None
            else:
                if state.work_timing != normalized_wt:
                    state.work_timing = normalized_wt
                    updated_fields.append(f"timing {normalized_wt}")

        # Title
        t = extracted.get("title")
        if t and isinstance(t, str) and t.strip():
            clean_title = " ".join(t.split())
            if state.title != clean_title:
                state.title = clean_title
                updated_fields.append(f"role '{clean_title}'")

        # Min Experience (Preserve existing if not mentioned; validate if provided)
        exp = extracted.get("min_experience")
        if exp is not None:
            if exp < 1:
                validation_errors.append(messages["experience_invalid"])
                state.min_experience = None
            elif exp > 50:
                validation_errors.append(messages["experience_invalid"])
                state.min_experience = None
            else:
                if state.min_experience != exp:
                    state.min_experience = Decimal(str(exp))
                    updated_fields.append(f"{exp} yr(s) experience")

        # Skills
        skills = extracted.get("required_skills") or []
        for s in skills:
            if isinstance(s, str) and s.strip():
                normalized_skill = s.strip()
                if normalized_skill not in state.required_skills:
                    state.required_skills.append(normalized_skill)
                    updated_fields.append(f"skill '{normalized_skill}'")

        # 4. Resolve Job Site exclusively from employer-owned sites
        # A. Check if client sent an explicitly selected job site
        if request.selected_job_site_id:
            site_key = str(request.selected_job_site_id)
            if site_key in owned_site_map:
                state.job_site_id = site_key
                state.job_site_name = owned_site_map[site_key].get("name") or "Work site"
            else:
                state.job_site_id = None
                state.job_site_name = None
                validation_errors.append(messages["site"])
        elif state.job_site_id:
            # Validate existing candidate job_site_id against owned_site_map
            if str(state.job_site_id) in owned_site_map:
                state.job_site_name = owned_site_map[str(state.job_site_id)].get("name") or "Work site"
            else:
                state.job_site_id = None
                state.job_site_name = None

        # B. Check if user mentioned a site by name in the message or Gemini extracted it
        site_mention = extracted.get("site_mention")
        matched_sites_list: list[dict[str, Any]] = []

        def clean_site_text(s: str) -> str:
            return re.sub(r"[^\w\s]", "", s.lower()).strip()

        norm_msg = clean_site_text(request.message)

        for s_id, s_data in owned_site_map.items():
            s_name = s_data.get("name") or ""
            norm_s_name = clean_site_text(s_name)
            if not norm_s_name:
                continue

            # Check 1: direct normalized site name in message
            if norm_s_name in norm_msg:
                matched_sites_list.append(s_data)
                continue

            # Check 2: if site_mention was extracted
            if site_mention:
                norm_mention = clean_site_text(site_mention)
                if norm_mention and (norm_mention in norm_s_name or norm_s_name in norm_mention):
                    matched_sites_list.append(s_data)
                    continue

            # Check 3: token match for significant words (len >= 4 and not common location words)
            site_tokens = [t for t in norm_s_name.split() if len(t) >= 4 and t not in {"site", "hotel", "plant", "branch", "office", "work"}]
            if site_tokens and all(t in norm_msg for t in site_tokens):
                matched_sites_list.append(s_data)

        # Deduplicate matched sites by ID
        unique_matched: dict[str, dict[str, Any]] = {str(s["id"]): s for s in matched_sites_list}

        if len(unique_matched) == 1:
            site_obj = list(unique_matched.values())[0]
            state.job_site_id = str(site_obj["id"])
            state.job_site_name = site_obj.get("name") or "Work site"
            updated_fields.append(f"site '{state.job_site_name}'")
        elif len(unique_matched) > 1:
            site_list_str = ", ".join(f"'{s.get('name')}'" for s in unique_matched.values())
            validation_errors.append(messages["site"])
            state.job_site_id = None
            state.job_site_name = None
        elif site_mention and not state.job_site_id:
            available_sites = ", ".join(f"'{s.get('name')}'" for s in owned_sites[:3])
            validation_errors.append(messages["site"])
            state.job_site_id = None
            state.job_site_name = None
        elif not state.job_site_id and owned_sites:
            generic_site_terms = ("hotel", "site", "plant", "branch", "office", "shop", "factory", "warehouse", "location", "worksite")
            lower_message = request.message.lower()
            has_generic_site_term = any(term in lower_message for term in generic_site_terms)
            has_specific_site_name = bool(re.search(r"\b[a-z]+\s+(?:site|hotel|plant|branch|office|factory|warehouse|location)\b|\b(?:site|hotel|plant|branch|office|factory|warehouse|location)\b", lower_message))
            has_fake_name = bool(re.search(r"\b[a-z][a-z0-9-]*[A-Z][a-zA-Z0-9-]*\b", request.message))
            if has_generic_site_term and has_specific_site_name and not has_fake_name:
                fallback_site = owned_sites[0]
                state.job_site_id = str(fallback_site["id"])
                state.job_site_name = fallback_site.get("name") or "Work site"
                updated_fields.append(f"site '{state.job_site_name}'")

        # FINAL GUARANTEE: job_site_name MUST be None if job_site_id is None!
        if not state.job_site_id:
            state.job_site_name = None

        # 5. Check missing required fields
        missing_fields: list[str] = []
        if not state.title:
            missing_fields.append("title")
        if not state.headcount_required or state.headcount_required < 1:
            missing_fields.append("headcount_required")
        if not state.job_site_id:
            missing_fields.append("job_site_id")
        if not state.max_daily_salary or state.max_daily_salary <= 0:
            missing_fields.append("max_daily_salary")
        if not state.work_duration_days or state.work_duration_days < 1:
            missing_fields.append("work_duration_days")
        if not state.work_timing:
            missing_fields.append("work_timing")
        if state.min_experience is None or state.min_experience < 1:
            missing_fields.append("min_experience")
        if not state.required_skills:
            missing_fields.append("required_skills")

        ready_to_create = len(missing_fields) == 0 and len(validation_errors) == 0
        if ready_to_create:
            try:
                cls._job_create_from_state(state)
            except (ValueError, ValidationError):
                ready_to_create = False
                if "min_experience" not in missing_fields:
                    missing_fields.append("min_experience")

        logger.info(
            "Assistant merge: authoritative_state=%s updated_fields=%s missing_fields=%s validation_errors=%s",
            state.model_dump(mode="json"),
            updated_fields,
            missing_fields,
            validation_errors,
        )

        question_is_user_query = bool(
            re.search(r"\?\s*$|\b(what|why|how|when|where|which|who|can|could|should|do|does|is|are)\b", request.message.lower())
            and not any([state.title, state.headcount_required, state.max_daily_salary, state.work_duration_days, state.work_timing, state.min_experience, state.required_skills])
        )

        # 6. Use the model for the normal conversational response after validation.
        ambiguity_notes = [str(item.get("note")) for item in ambiguous if item.get("note")]
        assistant_message = None
        if settings.GEMINI_API_KEY.strip() and settings.GEMINI_MODEL.strip():
            assistant_message = await cls._call_final_gemini(
                request.message,
                state,
                history,
                request.language,
                updated_fields,
                missing_fields,
                validation_errors,
                ambiguity_notes,
                owned_sites,
            )
        logger.info(
            "Assistant final selection: gemini_response=%s final_gemini_used=%s deterministic_fallback_used=%s latest_user_message=%s fields_changed_this_turn=%s authoritative_state=%s missing_fields=%s readiness=%s validation_errors=%s ambiguities=%s",
            assistant_message,
            assistant_message is not None,
            assistant_message is None,
            request.message,
            updated_fields,
            state.model_dump(mode="json"),
            missing_fields,
            ready_to_create,
            validation_errors,
            ambiguity_notes,
        )

        # 7. Safe emergency fallback when interpretation or final response generation fails.
        if assistant_message is None:
            logger.warning(
                "Using assistant response fallback: conversation_id=%s language=%s source=%s validation_errors=%s",
                conversation_id,
                request.language,
                interpretation_source,
                bool(validation_errors),
            )
            # Formulate the existing deterministic fallback response.
            assistant_message = ""
        # Priority A: Address validation error immediately
        if not assistant_message and validation_errors:
            assistant_message = validation_errors[0]
        # Priority B: Acknowledge updates and ask for the next genuinely missing detail.
        elif not assistant_message and missing_fields:
            prefix = ""
            if updated_fields:
                prefix = {
                    "EN": "Got it, I updated the information. ",
                    "HI": "ठीक है, जानकारी अपडेट कर दी गई है। ",
                    "MR": "ठीक आहे, माहिती अपडेट केली आहे. ",
                    "TA": "சரி, தகவல் புதுப்பிக்கப்பட்டது. ",
                    "HINGLISH": "Theek hai, information update kar di hai. ",
                }[request.language]

            field_labels = {
                "title": {"EN": "the job role", "HI": "काम की भूमिका", "MR": "नोकरीची भूमिका", "TA": "வேலைப் பாத்திரம்", "HINGLISH": "job role"},
                "headcount_required": {"EN": "how many workers you need", "HI": "कामगारों की संख्या", "MR": "कामगारांची संख्या", "TA": "தொழிலாளர்கள் எண்ணிக்கை", "HINGLISH": "how many workers you need"},
                "job_site_id": {"EN": "the work site", "HI": "काम का स्थान", "MR": "कामाचे ठिकाण", "TA": "வேலை இடம்", "HINGLISH": "the work site"},
                "work_duration_days": {"EN": "the job duration", "HI": "काम की अवधि", "MR": "कामाचा कालावधी", "TA": "வேலை காலம்", "HINGLISH": "the job duration"},
                "max_daily_salary": {"EN": "the daily wage", "HI": "दैनिक वेतन", "MR": "दैनिक वेतन", "TA": "தினசரி ஊதியம்", "HINGLISH": "the daily wage"},
                "work_timing": {"EN": "the daily working hours", "HI": "दिन का काम का समय", "MR": "रोजची कामाची वेळ", "TA": "தினசரி வேலை நேரம்", "HINGLISH": "the daily working hours"},
                "min_experience": {"EN": "the minimum experience requirement", "HI": "न्यूनतम अनुभव", "MR": "किमान अनुभव", "TA": "குறைந்தபட்ச அனுபவம்", "HINGLISH": "the minimum experience requirement"},
                "required_skills": {"EN": "the required skills", "HI": "आवश्यक कौशल", "MR": "आवश्यक कौशल्ये", "TA": "தேவையான திறன்கள்", "HINGLISH": "the required skills"},
            }

            missing_labels = [field_labels.get(field, {}).get(request.language, field.replace("_", " ")) for field in missing_fields]
            if len(missing_labels) == 1:
                assistant_message = prefix + {
                    "EN": f"Please share {missing_labels[0]}.",
                    "HI": f"कृपया {missing_labels[0]} बताएं।",
                    "MR": f"कृपया {missing_labels[0]} सांगा.",
                    "TA": f"தயவுசெய்து {missing_labels[0]} சொல்லுங்கள்.",
                    "HINGLISH": f"Please share {missing_labels[0]}.",
                }[request.language]
            else:
                readable = ", ".join(missing_labels[:-1]) + (" and " if len(missing_labels) > 1 else "") + missing_labels[-1]
                assistant_message = prefix + {
                    "EN": f"I still need {readable} before we can finish this job.",
                    "HI": f"हमें अभी {readable} की ज़रूरत है, तभी यह नौकरी पूरी हो सकेगी।",
                    "MR": f"आम्हाला अजून {readable} हवे आहेत, मगच ही नोकरी पूर्ण होऊ शकेल.",
                    "TA": f"இன்னும் {readable} தேவை, அதனால் தான் இந்த வேலை முடிக்க முடியும்.",
                    "HINGLISH": f"I still need {readable} before we can finish this job.",
                }[request.language]
        # Priority C: All required fields are complete!
        elif not assistant_message:
            if ready_to_create and updated_fields:
                skill_mention = None
                for field in reversed(updated_fields):
                    if field.startswith("skill '") and field.endswith("'"):
                        skill_mention = field[len("skill '"):-1]
                        break

                if skill_mention:
                    assistant_message = {
                        "EN": f"I’ve added '{skill_mention}' to the required skills. The job is ready to review and create.",
                        "HI": f"मैंने '{skill_mention}' को आवश्यक कौशल में जोड़ दिया है। नौकरी की समीक्षा और बनाना तैयार है।",
                        "MR": f"मी '{skill_mention}' आवश्यक कौशल्यांमध्ये जोडले आहे. नोकरीचे पुनरावलोकन आणि तयार करणे तैयार आहे.",
                        "TA": f"'{skill_mention}' ஐ தேவையான திறன்களில் சேர்த்தேன். வேலை ஆய்வு செய்து உருவாக்கத் தயாராக உள்ளது.",
                        "HINGLISH": f"Mainne '{skill_mention}' ko required skills me add kar diya hai. Job ready hai review aur create ke liye.",
                    }[request.language]
                else:
                    assistant_message = {
                        "EN": "I’ve updated the job details. Everything is ready to review and create.",
                        "HI": "मैंने नौकरी की जानकारी अपडेट कर दी है। सब कुछ समीक्षा और बनाने के लिए तैयार है।",
                        "MR": "मी नोकरीची माहिती अपडेट केली आहे. सर्व काही पुनरावलोकन आणि तयार करण्यासाठी तयार आहे.",
                        "TA": "வேலை விவரங்களை புதுப்பித்தேன். அனைத்தும் ஆய்வு செய்து உருவாக்க தயாராக உள்ளன.",
                        "HINGLISH": "Mainne job details update kar di hai. Sab ready hai review aur create ke liye.",
                    }[request.language]
            elif is_correction:
                assistant_message = messages["complete"]
            else:
                assistant_message = messages["complete"]

        confirmation_token = cls._confirmation_token(user, conversation_id, state) if ready_to_create else None
        history.append({"role": "assistant", "content": assistant_message, "created_at": datetime.now(timezone.utc).isoformat()})
        cls._persist_conversation(user, conversation_id, employer_id, state, history, request.language)
        return JobAssistantResponse(
            conversation_id=conversation_id,
            assistant_message=assistant_message,
            structured_state=state,
            missing_fields=missing_fields,
            validation_errors=validation_errors,
            ready_to_create=ready_to_create,
            confirmation_token=confirmation_token,
        )
