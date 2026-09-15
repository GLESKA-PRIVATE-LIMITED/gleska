"""Service for conversational employer job creation assistant."""

from datetime import datetime, timezone
import json
import logging
import re
from typing import Any
from uuid import UUID, uuid4

import httpx

from app.core.config import settings
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.job_assistant import (
    JobAssistantMessageRequest,
    JobAssistantResponse,
    JobAssistantState,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the GO LESKA AI Job Creation Assistant.
Your purpose is to help an employer define and refine job requirements conversationally.
You receive:
1. The currently known candidate state (fields already provided or null).
2. The employer's latest message (which may be a full description, answer to a question, or a correction like 'actually 7 workers', 'change wage to 800', 'duration 15 days').

Your job is to extract:
- 'title': Job title or role (e.g. Cook, Plumber, Mason, Welder).
- 'headcount_required': Number of workers required as an integer. ONLY set this when workers, people, or staff count is explicitly mentioned.
- 'max_daily_salary': Offered daily wage per worker in INR as a float/number.
- 'min_experience': Minimum years of experience as an integer (e.g. '1 year' -> 1, '3 years' -> 3, 'fresher' -> 0).
- 'work_duration_days': Total number of working days required as an integer. If employer says 'for 3 months', convert to 90 days (1 month = 30 days). If '2 weeks', convert to 14 days.
- 'work_timing': Daily shift hours as a normalized string (e.g. '8:00 AM – 5:00 PM', '9:00 AM – 6:00 PM', '10:00 PM – 6:00 AM').
- 'required_skills': List of specific skills mentioned.
- 'site_mention': Any site name or location keyword mentioned (e.g. 'Samiksha Hotel', 'Nanded').

CRITICAL RULES:
1. FIELD-AWARE NUMERIC ASSIGNMENT:
   NEVER assign a number to a field without semantic context.
   - 'for 90 days' -> work_duration_days = 90. Do NOT touch headcount_required.
   - 'for 3 months' -> work_duration_days = 90. Do NOT touch headcount_required.
   - 'minimum 1 year experience' -> min_experience = 1. Do NOT touch other fields.
   - '700 per day' -> max_daily_salary = 700.
   - 'need 5 workers' -> headcount_required = 5.
2. AMBIGUOUS NUMBERS:
   If the employer provides an isolated number with NO unit or context (e.g., 'I need 90', 'make it 50', '90'):
   Do NOT guess whether it means workers, days, or wage.
   Record it in 'ambiguous_inputs' with field: 'ambiguous_number' and note: 'Do you mean 90 workers or 90 days?'.
   Leave extracted fields null.
3. INVALID VALUES:
   If the employer specifies an INVALID value (workers < 1 like -5 or 0; wage <= 0; duration < 1 like -20 days; experience < 0; malformed timing like '90 AM to 200 PM'):
   Record it in 'invalid_raw_inputs' with the field name and raw text. Do NOT normalize it as valid.
4. AMBIGUOUS INPUTS:
   Shift names without hours ('morning shift', 'night shift') -> record in ambiguous_inputs.
5. CORRECTIONS & PRESERVATION:
   If employer updates a field ('Actually make it 7 workers', 'Change wage to 800'):
   Extract the new value and set 'is_correction': true.
   Leave fields NOT mentioned in the latest message as null in extracted, so the server preserves the existing state.
6. Return ONLY a JSON object matching the requested schema.
"""

LANGUAGE_NAMES = {"EN": "English", "HI": "Hindi", "MR": "Marathi", "TA": "Tamil", "HINGLISH": "natural Hinglish"}

MESSAGES = {
    "EN": {
        "workers_invalid": "The number of workers must be at least 1. How many workers do you need?",
        "duration_invalid": "The work duration must be at least 1 day. How many days will the workers be required?",
        "wage_invalid": "The daily wage must be greater than ₹0. Please provide the daily wage per worker.",
        "timing_invalid": "That doesn't look like a valid working time. Please provide the daily working hours, for example 8 AM to 5 PM.",
        "experience_invalid": "Experience cannot be negative. Please specify 0 or more years.",
        "title": "What type of work or role do you need workers for?",
        "workers": "How many workers do you need for this job?",
        "site": "Please select or add a work site so we know the job location.",
        "duration": "How many days will the workers be required to work?",
        "wage": "What daily wage (in ₹) would you like to offer per worker?",
        "timing": "What are the daily working hours? For example, 8 AM to 5 PM.",
        "complete": "Everything looks complete! Please review the job preview and click 'Create Job' to publish it.",
    },
    "HI": {
        "workers_invalid": "कामगारों की संख्या कम से कम 1 होनी चाहिए। कृपया सही संख्या बताएं।",
        "duration_invalid": "काम की अवधि कम से कम 1 दिन होनी चाहिए। कामगारों की आवश्यकता कितने दिनों के लिए है?",
        "wage_invalid": "दैनिक वेतन ₹0 से अधिक होना चाहिए। कृपया प्रति कामगार दैनिक वेतन बताएं।",
        "timing_invalid": "काम का समय सही नहीं लगता। कृपया रोज़ाना काम का समय बताएं, जैसे सुबह 8 बजे से शाम 5 बजे तक।",
        "experience_invalid": "अनुभव ऋणात्मक नहीं हो सकता। कृपया 0 या उससे अधिक वर्षों का अनुभव बताएं।",
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
        "experience_invalid": "अनुभव ऋणात्मक असू शकत नाही. कृपया 0 किंवा त्याहून अधिक वर्षांचा अनुभव सांगा.",
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
        "experience_invalid": "அனுபவம் எதிர்மறையாக இருக்க முடியாது. 0 அல்லது அதற்கு மேற்பட்ட ஆண்டுகளைக் குறிப்பிடுங்கள்.",
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
        "experience_invalid": "Experience negative nahi ho sakta. 0 ya usse zyada years batayein.",
        "title": "Aapko kis type ke kaam ya role ke liye workers chahiye?",
        "workers": "Aapko kitne workers chahiye?",
        "site": "Please work site select ya add karein.",
        "duration": "Workers kitne din ke liye chahiye?",
        "wage": "Aap per worker kitni daily wage dena chahenge?",
        "timing": "Daily working hours kya honge? Jaise subah 8 baje se shaam 5 baje tak.",
        "complete": "Saari information complete hai. Job preview check karke job banane ke liye 'Job Banayein' par click karein.",
    },
}


class JobAssistantService:
    """Manages multi-turn state merging, validation, and conversational messaging."""

    @staticmethod
    def _gemini_schema() -> dict[str, Any]:
        return {
            "type": "OBJECT",
            "properties": {
                "extracted": {
                    "type": "OBJECT",
                    "properties": {
                        "title": {"type": "STRING", "nullable": True},
                        "headcount_required": {"type": "INTEGER", "nullable": True},
                        "max_daily_salary": {"type": "NUMBER", "nullable": True},
                        "min_experience": {"type": "INTEGER", "nullable": True},
                        "work_duration_days": {"type": "INTEGER", "nullable": True},
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
            "required": ["extracted", "invalid_raw_inputs", "ambiguous_inputs", "is_correction"],
        }

    @classmethod
    async def _call_gemini(cls, message: str, current_state: JobAssistantState, language: str) -> dict[str, Any]:
        """Calls Gemini to interpret user message in context of current state."""
        api_key = settings.GEMINI_API_KEY.strip()
        model = settings.GEMINI_MODEL.strip()
        if not api_key or not model:
            return cls._fallback_rule_extractor(message, current_state)

        user_content = (
            f"Selected conversation language: {LANGUAGE_NAMES[language]}\n"
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
                return json.loads(raw_text)
            logger.warning("Gemini assistant call returned status %s, using fallback extractor", response.status_code)
        except Exception as exc:
            logger.warning("Gemini assistant call failed (%s), using fallback extractor", exc)

        return cls._fallback_rule_extractor(message, current_state, language)

    @classmethod
    def _fallback_rule_extractor(cls, message: str, current_state: JobAssistantState, language: str = "EN") -> dict[str, Any]:
        """Fast, field-aware regex/rule-based parser as a reliable fallback."""
        text = message.strip()
        lower = text.lower()
        extracted: dict[str, Any] = {"required_skills": []}
        invalid_raw_inputs: list[dict[str, str]] = []
        ambiguous_inputs: list[dict[str, str]] = []

        # 1. Check for ambiguous isolated numbers (e.g., "I need 90", "90", "make it 50")
        # An isolated number with NO field keywords must not be arbitrarily assigned.
        amb_match = re.search(r"^(?:i\s+need\s+|need\s+|want\s+|make\s+it\s+|actually\s+)?(\d+)(?:\s+only)?\.?$", lower)
        has_field_keyword = any(kw in lower for kw in [
            "worker", "workers", "people", "person", "helper", "helpers", "cook", "cooks",
            "mason", "masons", "plumber", "plumbers", "electrician", "staff", "labourer", "labourers",
            "day", "days", "month", "months", "week", "weeks",
            "year", "years", "yr", "yrs", "exp", "experience",
            "₹", "rs", "inr", "salary", "wage", "per day", "daily", "/day", "pay",
            "am", "pm", "shift", "timing", "hours"
        ]) or any(kw in lower for kw in ["कामगार", "कुक", "दिन", "दिवस", "வேலை", "தொழிலாளர்", "நாள்"])
        if amb_match and not has_field_keyword:
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

        # 2. Duration (months -> x30, weeks -> x7, days)
        dur_neg = re.search(r"(-\d+)\s*(?:days?|working\s+days?|weeks?|months?)", lower)
        if dur_neg:
            invalid_raw_inputs.append({"field": "work_duration_days", "raw_value": dur_neg.group(1)})
        else:
            # Check months first (e.g., "for 3 months", "3 months")
            month_match = re.search(r"(?:for|duration(?:\s+is)?\s*)?(\d+)\s*months?\b", lower)
            if month_match:
                extracted["work_duration_days"] = int(month_match.group(1)) * 30
            else:
                # Check weeks (e.g., "for 2 weeks")
                week_match = re.search(r"(?:for|duration(?:\s+is)?\s*)?(\d+)\s*weeks?\b", lower)
                if week_match:
                    extracted["work_duration_days"] = int(week_match.group(1)) * 7
                else:
                    # Check days (e.g., "for 90 days", "90 days")
                    day_match = re.search(r"(?:for|duration(?:\s+is)?\s*)?(\d+)\s*(?:working\s+)?days?\b", lower)
                    if not day_match and language in {"HI", "MR", "TA", "HINGLISH"}:
                        day_match = re.search(r"(\d+)\s*(?:दिनों?|दिवस|நாட்கள்?|நாள்)", lower)
                    if day_match:
                        extracted["work_duration_days"] = int(day_match.group(1))

        # 3. Experience (years / yrs / freshers)
        exp_neg = re.search(r"(-\d+)\s*(?:years?|yrs?)(?:\s+of)?\s*experience", lower)
        if exp_neg:
            invalid_raw_inputs.append({"field": "min_experience", "raw_value": exp_neg.group(1)})
        else:
            exp_match = (
                re.search(r"(?:min(?:imum)?\s*)?(\d+)\s*(?:\+|plus)?\s*(?:years?|yrs?)(?:\s+of)?\s*experience\b", lower)
                or re.search(r"experience(?:\s+of)?\s*(?:at\s+least\s+|minimum\s+)?(\d+)\s*(?:years?|yrs?)\b", lower)
                or re.search(r"(\d+)\s*(?:years?|yrs?)\s+exp\b", lower)
            )
            if exp_match:
                extracted["min_experience"] = int(exp_match.group(1))
            elif re.search(r"\b(?:fresher|freshers|no\s+experience|0\s+years?(?:\s+experience)?)\b", lower):
                extracted["min_experience"] = 0

        # 4. Workers / Headcount
        # CRITICAL: Require explicit worker/staff keywords so numbers for days/salary/experience are never assigned to headcount
        worker_neg = re.search(r"(-\d+)\s*(?:workers?|people|persons?|helpers?|cooks?|labourers?|masons?|staff)", lower)
        if worker_neg:
            invalid_raw_inputs.append({"field": "headcount_required", "raw_value": worker_neg.group(1)})
        else:
            worker_match = (
                re.search(r"\b(\d+)\s*(?:workers?|people|persons?|helpers?|cooks?|labourers?|masons?|plumbers?|electricians?|carpenters?|painters?|welders?|drivers?|staff)\b", lower)
                or re.search(r"(?:need|require|hire|want|headcount(?:\s+of)?|actually\s+(?:need\s+)?|make\s+it)\s+(\d+)\s+(?:workers?|people|persons?|helpers?|staff|labourers?|cooks?|masons?)", lower)
            )
            if not worker_match and language in {"HI", "MR", "TA", "HINGLISH"}:
                worker_match = re.search(r"(\d+)\s*(?:कामगार|कुक|श्रमिक|தொழிலாளர்கள்?|சமையல்காரர்கள்?)", lower)
            if worker_match:
                extracted["headcount_required"] = int(worker_match.group(1))

        # 5. Salary / Wage
        wage_neg = re.search(r"(?:₹|rs\.?|inr|salary|wage)?\s*(-\d+)\s*(?:per\s+day|daily|/day)?", lower)
        if wage_neg and int(wage_neg.group(1)) <= 0:
            invalid_raw_inputs.append({"field": "max_daily_salary", "raw_value": wage_neg.group(1)})
        else:
            wage_match = (
                re.search(r"(?:₹|rs\.?|inr|salary|wage|pay(?:ing)?)\s*[:=]?\s*(\d+)", lower)
                or re.search(r"(\d+)\s*(?:per\s+day|daily|per\s+diem|/day)\b", lower)
            )
            if wage_match:
                val = float(wage_match.group(1))
                if val <= 0:
                    invalid_raw_inputs.append({"field": "max_daily_salary", "raw_value": str(val)})
                else:
                    extracted["max_daily_salary"] = val

        # 6. Timing
        if "morning shift" in lower or "night shift" in lower or "evening shift" in lower:
            ambiguous_inputs.append({"field": "work_timing", "note": "Shift name specified without exact hours"})
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

        # 7. Role / Title
        for role in ["cook", "chef", "mason", "plumber", "electrician", "carpenter", "welder", "painter", "driver", "security guard", "helper", "cleaner", "construction worker", "labourer"]:
            if re.search(rf"\b{role}s?\b", lower):
                extracted["title"] = role.title()
                break
        if not extracted.get("title"):
            if re.search(r"कुक|रसोइया|சமையல்கார", lower):
                extracted["title"] = "Cook"
            elif re.search(r"स्वयंपाकी|स्वयंपाक", lower):
                extracted["title"] = "Cook"

        # 8. Site mention
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
        conversation_id = request.conversation_id or str(uuid4())

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
        gemini_result = await cls._call_gemini(request.message, request.current_state, request.language)
        extracted = gemini_result.get("extracted") or {}
        invalid_raw = gemini_result.get("invalid_raw_inputs") or []
        ambiguous = gemini_result.get("ambiguous_inputs") or []
        is_correction = gemini_result.get("is_correction", False)

        # Start with current state (client candidate state)
        state = request.current_state.model_copy()
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

        # Work Duration (Only update if duration is explicitly extracted and valid)
        dur = extracted.get("work_duration_days")
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
            if exp < 0:
                validation_errors.append(messages["experience_invalid"])
                state.min_experience = None
            elif exp > 50:
                validation_errors.append(messages["experience_invalid"])
                state.min_experience = None
            else:
                if state.min_experience != exp:
                    state.min_experience = exp
                    updated_fields.append(f"{exp} yr(s) experience")

        # Skills
        skills = extracted.get("required_skills") or []
        for s in skills:
            if isinstance(s, str) and s.strip() and s.strip() not in state.required_skills:
                state.required_skills.append(s.strip())

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

        ready_to_create = len(missing_fields) == 0 and len(validation_errors) == 0

        # 6. Formulate conversational response message
        # Priority A: Address validation error immediately
        if validation_errors:
            assistant_message = validation_errors[0]
        # Priority B: Acknowledge updates and ask for the next single missing required field
        elif missing_fields:
            prefix = ""
            if updated_fields:
                prefix = {
                    "EN": "Got it, I updated the information. ",
                    "HI": "ठीक है, जानकारी अपडेट कर दी गई है। ",
                    "MR": "ठीक आहे, माहिती अपडेट केली आहे. ",
                    "TA": "சரி, தகவல் புதுப்பிக்கப்பட்டது. ",
                    "HINGLISH": "Theek hai, information update kar di hai. ",
                }[request.language]

            next_field = missing_fields[0]
            if next_field == "title":
                assistant_message = prefix + messages["title"]
            elif next_field == "headcount_required":
                assistant_message = prefix + messages["workers"]
            elif next_field == "job_site_id":
                if owned_sites:
                    site_names = ", ".join(f"'{s.get('name')}'" for s in owned_sites[:3])
                    assistant_message = prefix + messages["site"]
                else:
                    assistant_message = prefix + messages["site"]
            elif next_field == "work_duration_days":
                assistant_message = prefix + messages["duration"]
            elif next_field == "max_daily_salary":
                assistant_message = prefix + messages["wage"]
            elif next_field == "work_timing":
                assistant_message = prefix + messages["timing"]
            else:
                assistant_message = prefix + f"Please specify {next_field}."
        # Priority C: All required fields are complete!
        else:
            if is_correction:
                assistant_message = messages["complete"]
            else:
                assistant_message = messages["complete"]

        return JobAssistantResponse(
            conversation_id=conversation_id,
            assistant_message=assistant_message,
            structured_state=state,
            missing_fields=missing_fields,
            validation_errors=validation_errors,
            ready_to_create=ready_to_create,
        )
