"""Unit tests for the conversational job creation assistant."""

from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4
import pytest
from pydantic import ValidationError

from app.schemas.auth import UserResponse
from app.schemas.job import JobCreate
from app.core.config import settings
from app.schemas.job_assistant import (
    JobAssistantCreateRequest,
    JobAssistantMessageRequest,
    JobAssistantResponse,
    JobAssistantState,
    JobAssistantStateUpdateRequest,
)
from app.services.job_assistant_service import JobAssistantService
from app.services.job_service import JobService

EMPLOYER_USER = UserResponse(
    id="user-123",
    name="Test Employer",
    mobile="919876543210",
    role="EMPLOYER",
    is_mobile_verified=True,
    is_active=True,
    created_at="2026-01-01T00:00:00Z",
    updated_at="2026-01-01T00:00:00Z",
)

OTHER_EMPLOYER_USER = EMPLOYER_USER.model_copy(update={"id": "user-456", "name": "Other Employer"})

OWNED_SITE_ID = "11111111-1111-1111-1111-111111111111"
OTHER_SITE_ID = "99999999-9999-9999-9999-999999999999"


def seed_conversation(database, state: JobAssistantState) -> str:
    conversation_id = str(uuid4())
    database.assistant_conversations.append({
        "id": conversation_id,
        "user_id": EMPLOYER_USER.id,
        "employer_id": "employer-profile-1",
        "structured_state": state.model_dump(mode="json"),
        "history": [],
        "language": "EN",
        "status": "ACTIVE",
    })
    return conversation_id


class FakeSupabaseTable:
    def __init__(self, data):
        self.data = data
        self._filters = []
        self._single = False

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, field, value):
        self._filters.append((field, value))
        return self

    def insert(self, payload):
        row = {**payload, "id": payload.get("id", str(uuid4()))}
        self.data.append(row)
        self._inserted = row
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def single(self):
        self._single = True
        return self

    def execute(self):
        filtered = self.data
        if self._filters:
            for f, v in self._filters:
                filtered = [row for row in filtered if str(row.get(f)) == str(v)]
        if self._single:
            return SimpleNamespace(data=filtered[0] if filtered else {})
        if hasattr(self, "_update_payload"):
            for row in filtered:
                row.update(self._update_payload)
            return SimpleNamespace(data=filtered)
        if hasattr(self, "_inserted"):
            return SimpleNamespace(data=[self._inserted])
        return SimpleNamespace(data=filtered)


class FakeSupabaseAssistant:
    def __init__(self):
        self.employer_profiles = [
            {"id": "employer-profile-1", "user_id": "user-123", "onboarding_status": "COMPLETED"},
            {"id": "employer-profile-2", "user_id": "user-456", "onboarding_status": "COMPLETED"},
        ]
        self.job_sites = [
            {"id": OWNED_SITE_ID, "employer_id": "employer-profile-1", "name": "Nanded Site", "address": "Nanded City"},
            {"id": "22222222-2222-2222-2222-222222222222", "employer_id": "employer-profile-1", "name": "Pune Plant", "address": "Pune MIDC"},
        ]
        self.assistant_conversations = []

    def table(self, name):
        if name == "employer_profiles":
            return FakeSupabaseTable(self.employer_profiles)
        if name == "job_sites":
            return FakeSupabaseTable(self.job_sites)
        if name == "assistant_conversations":
            return FakeSupabaseTable(self.assistant_conversations)
        return FakeSupabaseTable([])


@pytest.fixture(autouse=True)
def mock_db(monkeypatch):
    database = FakeSupabaseAssistant()
    monkeypatch.setattr("app.services.job_assistant_service.supabase", database)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    return database


@pytest.mark.asyncio
async def test_complete_in_one_message():
    """Employer provides all required information in a single natural-language message."""
    request = JobAssistantMessageRequest(
        message="I need 5 cooks at my Nanded site for 20 days, paying ₹700 per day, 8 AM to 5 PM, minimum 1 year experience, South Indian breakfast cooking skills.",
        current_state=JobAssistantState(),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)

    assert isinstance(response, JobAssistantResponse)
    state = response.structured_state
    assert state.headcount_required == 5
    assert state.title == "Cook"
    assert state.work_duration_days == 20
    assert state.max_daily_salary == 700.0
    assert state.job_site_id == OWNED_SITE_ID
    assert "8" in state.work_timing and "5" in state.work_timing
    assert state.min_experience == 1
    assert any("south indian" in skill.lower() for skill in state.required_skills)
    assert response.ready_to_create is True
    assert len(response.validation_errors) == 0
    assert len(response.missing_fields) == 0


@pytest.mark.asyncio
async def test_manual_state_update_is_canonical_and_revisioned(mock_db):
    conversation_id = seed_conversation(mock_db, JobAssistantState(title="Loading Work", max_daily_salary=800))
    state, missing_fields, invalid_fields, validation_errors, ready, token, revision = JobAssistantService.update_manual_state(
        EMPLOYER_USER,
        JobAssistantStateUpdateRequest(
            conversation_id=conversation_id,
            state=JobAssistantState(title="Loading Work", max_daily_salary=1000),
            state_revision=0,
        ),
    )

    assert state.max_daily_salary == 1000
    assert "headcount_required" in missing_fields
    assert "required_skills" not in missing_fields
    assert ready is False
    assert token is None
    assert revision == 1
    assert mock_db.assistant_conversations[0]["structured_state"]["max_daily_salary"] == 1000

    with pytest.raises(ValueError, match="STALE_ASSISTANT_STATE"):
        JobAssistantService.update_manual_state(
            EMPLOYER_USER,
            JobAssistantStateUpdateRequest(
                conversation_id=conversation_id,
                state=JobAssistantState(title="Loading Work", max_daily_salary=700),
                state_revision=0,
            ),
        )
@pytest.mark.asyncio
async def test_multi_turn_conversation():
    """Employer provides info turn by turn. State must persist across turns."""
    # Turn 1: headcount
    turn1 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="I need 5 workers.", current_state=JobAssistantState()),
    )
    assert turn1.structured_state.headcount_required == 5
    assert turn1.ready_to_create is False
    assert "title" in turn1.missing_fields

    # Turn 2: role
    turn2 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="Construction labourers", conversation_id=turn1.conversation_id),
    )
    # Turn 1's headcount must still be 5
    assert turn2.structured_state.headcount_required == 5
    assert turn2.structured_state.title is not None

    # Turn 3: wage
    turn3 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="700 per day", conversation_id=turn2.conversation_id),
    )
    assert turn3.structured_state.max_daily_salary == 700.0
    assert turn3.structured_state.headcount_required == 5

    # Turn 4: duration
    turn4 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="For 20 days", conversation_id=turn3.conversation_id),
    )
    assert turn4.structured_state.work_duration_days == 20

    # Turn 5: timing & site
    turn5 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(
            message="8 AM to 5 PM at Nanded site",
            conversation_id=turn4.conversation_id,
        ),
    )
    assert turn5.structured_state.work_timing is not None
    assert turn5.structured_state.job_site_id == OWNED_SITE_ID
    assert turn5.ready_to_create is False

    turn6 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(
            message="minimum 1 year experience and South Indian breakfast cooking skills",
            conversation_id=turn5.conversation_id,
        ),
    )
    assert turn6.structured_state.min_experience == 1
    assert any("south indian" in skill.lower() for skill in turn6.structured_state.required_skills)
    assert turn6.ready_to_create is True


@pytest.mark.asyncio
async def test_server_state_and_history_win_over_stale_client_state(mock_db):
    role_turn = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="Cook", language="EN"),
    )
    count_turn = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(
            message="10 workers",
            conversation_id=role_turn.conversation_id,
            language="EN",
        ),
    )
    site_turn = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(
            message="Nanded Site",
            conversation_id=count_turn.conversation_id,
            language="HI",
        ),
    )
    resumed = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(
            message="continue",
            conversation_id=site_turn.conversation_id,
            language="MR",
            current_state=JobAssistantState(title="Cook"),
        ),
    )

    assert resumed.structured_state.title == "Cook"
    assert resumed.structured_state.headcount_required == 10
    assert resumed.structured_state.job_site_id == OWNED_SITE_ID
    conversation = mock_db.assistant_conversations[0]
    assert conversation["language"] == "MR"
    assert [entry["role"] for entry in conversation["history"]] == [
        "user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"
    ]


@pytest.mark.asyncio
async def test_other_employer_cannot_resume_conversation():
    first = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="Cook"),
    )

    with pytest.raises(ValueError, match="CONVERSATION_NOT_FOUND"):
        await JobAssistantService.process_message(
            OTHER_EMPLOYER_USER,
            JobAssistantMessageRequest(message="10 workers", conversation_id=first.conversation_id),
        )


@pytest.mark.asyncio
async def test_immediate_rejection_of_invalid_workers():
    """Negative or zero worker count must be rejected immediately without being stored."""
    request = JobAssistantMessageRequest(
        message="I need -5 workers",
        current_state=JobAssistantState(title="Plumber"),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)

    assert response.ready_to_create is False
    assert any("at least 1" in err for err in response.validation_errors)
    assert response.structured_state.headcount_required is None


@pytest.mark.asyncio
async def test_immediate_rejection_of_invalid_duration():
    """Negative duration must be rejected immediately."""
    request = JobAssistantMessageRequest(
        message="Workers needed for -20 days",
        current_state=JobAssistantState(title="Cook", headcount_required=3),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)

    assert response.ready_to_create is False
    assert any("at least 1 day" in err for err in response.validation_errors)
    assert response.structured_state.work_duration_days is None


@pytest.mark.asyncio
async def test_immediate_rejection_of_zero_wage():
    """₹0 wage must be rejected immediately."""
    request = JobAssistantMessageRequest(
        message="Salary is ₹0",
        current_state=JobAssistantState(title="Cook", headcount_required=3),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)

    assert response.ready_to_create is False
    assert any("greater than ₹0" in err for err in response.validation_errors)
    assert response.structured_state.max_daily_salary is None


@pytest.mark.asyncio
async def test_immediate_rejection_of_malformed_timing():
    """Nonsense timing must be rejected and clarified."""
    request = JobAssistantMessageRequest(
        message="Timing from 90 AM to 200 PM",
        current_state=JobAssistantState(title="Cook", headcount_required=3),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)

    assert response.ready_to_create is False
    assert any("valid working time" in err for err in response.validation_errors)
    assert response.structured_state.work_timing is None


@pytest.mark.asyncio
async def test_ambiguous_timing_clarification():
    """'Morning shift' without exact hours must be clarified rather than guessed."""
    request = JobAssistantMessageRequest(
        message="They will work morning shift",
        current_state=JobAssistantState(title="Cook", headcount_required=3),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)

    assert response.ready_to_create is False
    assert any("exact daily working hours" in err for err in response.validation_errors)
    assert response.structured_state.work_timing is None


@pytest.mark.asyncio
async def test_corrections(mock_db):
    """User says 'Actually make it 7 workers' and state updates from 5 to 7."""
    initial_state = JobAssistantState(
        title="Cook",
        headcount_required=5,
        max_daily_salary=700.0,
        min_experience=1,
        work_duration_days=20,
        work_timing="8:00 AM – 5:00 PM",
        required_skills=["South Indian cooking", "Breakfast preparation"],
        job_site_id=OWNED_SITE_ID,
    )
    request = JobAssistantMessageRequest(
        message="Actually make it 7 workers",
        conversation_id=seed_conversation(mock_db, initial_state),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)

    assert response.structured_state.headcount_required == 7
    # Duration, title, salary, etc. must be preserved
    assert response.structured_state.work_duration_days == 20
    assert response.structured_state.max_daily_salary == 700.0
    assert response.structured_state.title == "Cook"
    assert response.ready_to_create is True


@pytest.mark.asyncio
async def test_live_failure_conversation_keeps_required_skills_and_experience(mock_db):
    """Regression for the real browser conversation: natural phrasing, corrections, and required-field readiness."""
    turn1 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="I need some workers for my hotel.", current_state=JobAssistantState()),
    )
    turn2 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="its samiksha'hotel", conversation_id=turn1.conversation_id),
    )
    turn3 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(
            message="i want south indian cooks who can cook good breakfast",
            conversation_id=turn2.conversation_id,
        ),
    )
    assert turn3.structured_state.title == "Cook"
    assert any("south indian" in s.lower() for s in turn3.structured_state.required_skills)
    assert any("breakfast" in s.lower() for s in turn3.structured_state.required_skills)

    turn4 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="i need almost 10 workers", conversation_id=turn3.conversation_id),
    )
    assert turn4.structured_state.headcount_required == 10

    turn5 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="5 hundred", conversation_id=turn4.conversation_id),
    )
    assert turn5.structured_state.max_daily_salary == 500.0

    turn6 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="700 per day", conversation_id=turn5.conversation_id),
    )
    assert turn6.structured_state.max_daily_salary == 700.0

    turn7 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="2 months", conversation_id=turn6.conversation_id),
    )
    assert turn7.structured_state.work_duration_days == 60

    turn8 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="from morning 10 to evening 6", conversation_id=turn7.conversation_id),
    )
    assert turn8.structured_state.work_timing is not None

    turn9 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="and i want twelve workers not 10", conversation_id=turn8.conversation_id),
    )
    assert turn9.structured_state.headcount_required == 12

    turn10 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="minimum experience should be at least a year", conversation_id=turn9.conversation_id),
    )
    assert turn10.structured_state.min_experience == 1

    assert turn10.ready_to_create is True
    assert turn10.structured_state.required_skills
    assert "min_experience" not in turn10.missing_fields
    assert "required_skills" not in turn10.missing_fields
    assert turn10.structured_state.job_site_id == OWNED_SITE_ID


@pytest.mark.asyncio
async def test_final_response_receives_changed_fields_for_browser_sequence(mock_db, monkeypatch):
    calls = []

    async def capture_final_response(
        message,
        state,
        _history,
        _language,
        updated_fields,
        missing_fields,
        _validation_errors,
        _ambiguity_notes,
        _owned_sites,
    ):
        calls.append({
            "message": message,
            "state": state.model_dump(mode="json"),
            "updated_fields": updated_fields,
            "missing_fields": missing_fields,
        })
        return "Acknowledged the latest update."

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GEMINI_MODEL", "test-model")
    monkeypatch.setattr(JobAssistantService, "_call_final_gemini", capture_final_response)

    messages = [
        "I need 12 south Indian cooks who can cook good breakfast.",
        "Pay them seven hundred per day.",
        "Actually make that 15 workers.",
        "No, make the wage 800.",
        "I need them for two months.",
        "From morning 10 to evening 6.",
        "Minimum one year experience.",
    ]
    conversation_id = None
    for message in messages:
        response = await JobAssistantService.process_message(
            EMPLOYER_USER,
            JobAssistantMessageRequest(message=message, conversation_id=conversation_id),
        )
        conversation_id = response.conversation_id

    assert len(calls) == len(messages)
    assert calls[0]["state"]["title"] == "Cook"
    assert calls[0]["state"]["headcount_required"] == 12
    assert "12 workers" in calls[0]["updated_fields"]
    assert any("South Indian" in field for field in calls[0]["state"]["required_skills"])
    assert any("Breakfast" in field for field in calls[0]["state"]["required_skills"])
    assert "₹700/day wage" in calls[1]["updated_fields"]
    assert calls[2]["state"]["headcount_required"] == 15
    assert "15 workers" in calls[2]["updated_fields"]
    assert calls[3]["state"]["max_daily_salary"] == 800.0
    assert "₹800/day wage" in calls[3]["updated_fields"]
    assert calls[4]["state"]["work_duration_days"] == 60
    assert calls[5]["state"]["work_timing"] == "10:00 AM to 6:00 PM"
    assert calls[6]["state"]["min_experience"] == 1
    assert all("job_site_id" in call["missing_fields"] for call in calls)


@pytest.mark.asyncio
async def test_unauthorized_job_site_rejected():
    """If client sends a site ID not owned by employer, backend rejects it."""
    request = JobAssistantMessageRequest(
        message="I need 5 cooks",
        current_state=JobAssistantState(job_site_id=OTHER_SITE_ID),  # not owned!
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)

    # Server must strip the unauthorized job_site_id
    assert response.structured_state.job_site_id is None
    assert "job_site_id" in response.missing_fields
@pytest.mark.asyncio
async def test_duration_must_not_overwrite_workers(mock_db):
    """Test 1: 'for 90 days' must set work_duration_days=90 and NOT overwrite headcount_required."""
    initial = JobAssistantState(headcount_required=3, title="Cook")
    request = JobAssistantMessageRequest(
        message="for 90 days",
        conversation_id=seed_conversation(mock_db, initial),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)
    assert response.structured_state.headcount_required == 3
    assert response.structured_state.work_duration_days == 90


@pytest.mark.asyncio
async def test_months_conversion(mock_db):
    """Test 2: 'for 3 months' converts to work_duration_days=90 while headcount remains untouched."""
    initial = JobAssistantState(headcount_required=4, title="Painter")
    request = JobAssistantMessageRequest(
        message="for 3 months",
        conversation_id=seed_conversation(mock_db, initial),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)
    assert response.structured_state.work_duration_days == 90
    assert response.structured_state.headcount_required == 4


@pytest.mark.asyncio
async def test_fractional_experience_is_rejected_with_validation_feedback(mock_db):
    state = JobAssistantState(title="Cook", headcount_required=2, job_site_id=OWNED_SITE_ID, required_skills=["Cooking"])
    conversation_id = seed_conversation(mock_db, state)
    mock_db.assistant_conversations[-1]["history"] = [
        {"role": "assistant", "content": "How many years of experience do you need minimum?"},
    ]

    response = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="6 months", conversation_id=conversation_id),
    )

    assert response.structured_state.min_experience is None
    assert "min_experience" in response.missing_fields
    assert any("at least 1 year" in error.lower() for error in response.validation_errors)
    assert "at least 1 year" in response.assistant_message.lower()


@pytest.mark.asyncio
async def test_half_year_and_decimal_experience_remain_invalid(mock_db):
    state = JobAssistantState(title="Cook", headcount_required=2, job_site_id=OWNED_SITE_ID, required_skills=["Cooking"])
    conversation_id = seed_conversation(mock_db, state)
    mock_db.assistant_conversations[-1]["history"] = [
        {"role": "assistant", "content": "How many years of experience do you need minimum?"},
    ]

    half_year = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="half year min experience", conversation_id=conversation_id),
    )
    assert half_year.structured_state.min_experience is None
    assert any("at least 1 year" in error.lower() for error in half_year.validation_errors)

    decimal_year = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="0.5 years experience", conversation_id=conversation_id),
    )
    assert decimal_year.structured_state.min_experience is None
    assert any("at least 1 year" in error.lower() for error in decimal_year.validation_errors)


@pytest.mark.asyncio
async def test_duration_and_experience_are_distinct_in_mixed_year_month_message(mock_db):
    state = JobAssistantState(title="Cook", headcount_required=12, max_daily_salary=700.0, job_site_id=OWNED_SITE_ID, required_skills=["Cooking"])
    conversation_id = seed_conversation(mock_db, state)

    response = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="minimum 2 year 6 months ka", conversation_id=conversation_id),
    )

    assert response.structured_state.min_experience == 2.5
    assert response.structured_state.work_duration_days is None

    timing = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="Do mahine ke liye chahiye.", conversation_id=response.conversation_id),
    )
    assert timing.structured_state.work_duration_months == 2
    assert timing.structured_state.work_duration_days == 60

    timed_turn = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="Subah 10 se shaam 6 tak kaam hoga.", conversation_id=timing.conversation_id),
    )
    assert timed_turn.structured_state.work_duration_days == 60
    assert timed_turn.structured_state.work_timing == "10:00 AM to 6:00 PM"
    assert "work_duration_days" not in timed_turn.missing_fields


@pytest.mark.asyncio
async def test_one_year_experience_is_valid(mock_db):
    state = JobAssistantState(title="Cook", headcount_required=2, job_site_id=OWNED_SITE_ID, required_skills=["Cooking"])
    conversation_id = seed_conversation(mock_db, state)
    mock_db.assistant_conversations[-1]["history"] = [
        {"role": "assistant", "content": "How many years of experience do you need minimum?"},
    ]

    response = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="1 year experience", conversation_id=conversation_id),
    )

    assert response.structured_state.min_experience == 1
    assert not response.validation_errors
    assert "min_experience" not in response.missing_fields


@pytest.mark.asyncio
async def test_numeric_and_word_month_durations_use_thirty_days_per_month(mock_db):
    state = JobAssistantState(title="Cook", headcount_required=2)
    word_conversation_id = seed_conversation(mock_db, state)
    word_response = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="I need them for two months", conversation_id=word_conversation_id),
    )

    numeric_conversation_id = seed_conversation(mock_db, state)
    numeric_response = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="I need them for 2 months", conversation_id=numeric_conversation_id),
    )

    assert word_response.structured_state.work_duration_days == 60
    assert numeric_response.structured_state.work_duration_days == 60
    assert word_response.structured_state.work_duration_months == 2
    assert numeric_response.structured_state.work_duration_months == 2
    assert word_response.structured_state.work_duration_days == numeric_response.structured_state.work_duration_days


@pytest.mark.asyncio
async def test_correction_replaces_authoritative_headcount(mock_db):
    initial = JobAssistantState(title="Cook", headcount_required=12)
    conversation_id = seed_conversation(mock_db, initial)

    response = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="Actually 15 kar do workers", conversation_id=conversation_id),
    )

    assert response.structured_state.headcount_required == 15
    persisted = mock_db.assistant_conversations[0]
    assert persisted["structured_state"]["headcount_required"] == 15


@pytest.mark.asyncio
async def test_gemini_month_proposal_is_normalized_by_backend(mock_db, monkeypatch):
    async def interpret_months(*_args, **_kwargs):
        return {
            "_source": "gemini",
            "extracted": {"work_duration_months": 2, "required_skills": []},
            "invalid_raw_inputs": [],
            "ambiguous_inputs": [],
            "is_correction": False,
        }

    monkeypatch.setattr(JobAssistantService, "_call_gemini", interpret_months)
    state = JobAssistantState(title="Cook", headcount_required=2)
    conversation_id = seed_conversation(mock_db, state)

    response = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="I need them for two months", conversation_id=conversation_id),
    )

    assert response.structured_state.work_duration_days == 60


@pytest.mark.asyncio
async def test_experience_preservation():
    """Test 3: 'minimum 1 year experience' is captured into min_experience."""
    request = JobAssistantMessageRequest(
        message="I need workers with minimum 1 year experience",
        current_state=JobAssistantState(title="Electrician"),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)
    assert response.structured_state.min_experience == 1


@pytest.mark.asyncio
async def test_experience_survives_another_update(mock_db):
    """Test 4: min_experience is preserved when user later updates a different field."""
    initial = JobAssistantState(
        title="Welder",
        min_experience=1,
        headcount_required=3,
    )
    request = JobAssistantMessageRequest(
        message="Actually I need 8 workers",
        conversation_id=seed_conversation(mock_db, initial),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)
    assert response.structured_state.headcount_required == 8
    assert response.structured_state.min_experience == 1


@pytest.mark.asyncio
async def test_selected_job_site_authoritative():
    """Test 5: Real employer-owned job site provided via selected_job_site_id is resolved."""
    request = JobAssistantMessageRequest(
        message="I need 3 carpenters",
        selected_job_site_id=UUID(OWNED_SITE_ID),
        current_state=JobAssistantState(),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)
    assert response.structured_state.job_site_id == OWNED_SITE_ID
    assert response.structured_state.job_site_name == "Nanded Site"


@pytest.mark.asyncio
async def test_no_fake_job_site_ids():
    """Test 6: If no valid site can be resolved, job_site_id is None and ready_to_create is False."""
    request = JobAssistantMessageRequest(
        message="I need 5 cooks at NonExistentSiteXYZ",
        current_state=JobAssistantState(),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)
    assert response.structured_state.job_site_id is None
    assert response.structured_state.job_site_name is None
    assert response.ready_to_create is False
    assert "job_site_id" in response.missing_fields


@pytest.mark.asyncio
async def test_ambiguous_number_clarification():
    """Test 7: 'I need 90' without field context must trigger clarification question, NOT guess."""
    request = JobAssistantMessageRequest(
        message="I need 90",
        current_state=JobAssistantState(title="Cook"),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)
    assert response.structured_state.headcount_required is None
    assert response.structured_state.work_duration_days is None
    assert response.ready_to_create is False
    assert any("90 workers or 90 days" in err for err in response.validation_errors)


@pytest.mark.asyncio
async def test_full_state_preservation_on_single_field_update(mock_db):
    """Test 8: Updating one field preserves all other existing valid fields."""
    initial = JobAssistantState(
        title="Chef",
        headcount_required=4,
        max_daily_salary=900.0,
        min_experience=2,
        work_duration_days=60,
        work_timing="9:00 AM – 6:00 PM",
        required_skills=["North Indian cuisine", "Tandoor"],
        job_site_id=OWNED_SITE_ID,
        job_site_name="Nanded Site",
    )
    request = JobAssistantMessageRequest(
        message="Change wage to 950 per day",
        conversation_id=seed_conversation(mock_db, initial),
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)
    st = response.structured_state
    assert st.max_daily_salary == 950.0
    assert st.title == "Chef"
    assert st.headcount_required == 4
    assert st.min_experience == 2
    assert st.work_duration_days == 60
    assert st.work_timing == "9:00 AM – 6:00 PM"
    assert st.job_site_id == OWNED_SITE_ID
    assert response.ready_to_create is True


@pytest.mark.asyncio
async def test_invalid_values_rejected():
    """Test 9: Verify backend rejects invalid workers, duration, experience, salary, and timing."""
    # Negative workers
    r1 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="I need -5 workers", current_state=JobAssistantState()),
    )
    assert any("at least 1" in e for e in r1.validation_errors)
    assert r1.structured_state.headcount_required is None

    # Negative duration
    r2 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="For -20 days", current_state=JobAssistantState()),
    )
    assert any("at least 1 day" in e for e in r2.validation_errors)
    assert r2.structured_state.work_duration_days is None

    # Negative experience
    r3 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="With -2 years experience", current_state=JobAssistantState()),
    )
    assert any("at least 1 year" in e.lower() for e in r3.validation_errors)
    assert r3.structured_state.min_experience is None

    # Zero wage
    r4 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="Paying 0 per day", current_state=JobAssistantState()),
    )
    assert any("greater than ₹0" in e for e in r4.validation_errors)
    assert r4.structured_state.max_daily_salary is None


@pytest.mark.asyncio
async def test_readiness_consistency():
    """Test 10: Never return ready_to_create=True when required fields are missing."""
    incomplete_state = JobAssistantState(
        title="Mason",
        headcount_required=2,
        # missing salary, duration, timing, job_site_id
    )
    request = JobAssistantMessageRequest(
        message="Check readiness",
        current_state=incomplete_state,
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)
    assert response.ready_to_create is False
    assert "max_daily_salary" in response.missing_fields
    assert "work_duration_days" in response.missing_fields
    assert "work_timing" in response.missing_fields
    assert "job_site_id" in response.missing_fields


def test_validated_state_converts_to_authoritative_job_create():
    """Verified that JobAssistantState converts cleanly to JobCreate for existing JobService."""
    state = JobAssistantState(
        title="Chef",
        headcount_required=4,
        max_daily_salary=950.0,
        min_experience=2,
        work_duration_days=30,
        work_timing="9:00 AM – 6:00 PM",
        required_skills=["North Indian", "Tandoor"],
        job_site_id=OWNED_SITE_ID,
    )
    payload = JobCreate(
        job_site_id=UUID(state.job_site_id),
        title=state.title,
        headcount_required=state.headcount_required,
        max_daily_salary=Decimal(str(state.max_daily_salary)),
        min_experience=state.min_experience,
        work_duration_days=state.work_duration_days,
        work_timing=state.work_timing,
        required_skills=state.required_skills,
    )
    assert payload.headcount_required == 4
    assert payload.work_duration_days == 30
    assert payload.work_timing == "9:00 AM – 6:00 PM"
    assert payload.max_daily_salary == Decimal("950.0")


def test_fractional_experience_is_preserved_by_job_create_contract():
    state = JobAssistantState(
        title="Cook",
        headcount_required=15,
        max_daily_salary=700,
        min_experience=2.5,
        work_duration_months=2,
        work_duration_days=60,
        work_timing="10:00 AM to 6:00 PM",
        required_skills=["South Indian cooking", "Breakfast preparation"],
        job_site_id=OWNED_SITE_ID,
    )

    payload = JobAssistantService._job_create_from_state(state)

    assert payload.min_experience == Decimal("2.5")
    assert payload.work_duration_days == 60


@pytest.mark.asyncio
async def test_final_gemini_receives_authoritative_post_validation_context(monkeypatch):
    import json

    calls = []

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            calls.append(kwargs["json"])
            return SimpleNamespace(
                status_code=200,
                json=lambda: {"candidates": [{"content": {"parts": [{"text": json.dumps({"assistant_message": "I have updated the job details."})}]}}]},
            )

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GEMINI_MODEL", "test-model")
    monkeypatch.setattr("app.services.job_assistant_service.httpx.AsyncClient", lambda **kwargs: FakeClient())

    result = await JobAssistantService._call_final_gemini(
        "Actually 8 workers",
        JobAssistantState(title="Cook", headcount_required=8),
        [{"role": "user", "content": "I need 5 cooks"}],
        "EN",
        ["8 workers"],
        ["job_site_id", "max_daily_salary"],
        [],
        [],
        [],
    )

    assert result == "I have updated the job details."
    prompt = calls[0]["contents"][0]["parts"][0]["text"]
    assert '"headcount_required":8' in prompt
    assert "8 workers" in prompt
    assert "I need 5 cooks" in prompt


@pytest.mark.asyncio
async def test_ready_job_skill_addition_is_tracked_as_changed_field(mock_db, monkeypatch):
    initial = JobAssistantState(
        title="Cook",
        headcount_required=12,
        max_daily_salary=700.0,
        min_experience=2.5,
        work_duration_days=60,
        work_timing="10:00 AM to 6:00 PM",
        required_skills=["South Indian cooking", "Breakfast preparation"],
        job_site_id=OWNED_SITE_ID,
        job_site_name="Nanded Site",
    )
    conversation_id = seed_conversation(mock_db, initial)

    async def fake_gemini(*_args, **_kwargs):
        return {
            "_source": "gemini",
            "extracted": {"required_skills": ["Maharashtrian food preparation"]},
            "invalid_raw_inputs": [],
            "ambiguous_inputs": [],
            "is_correction": False,
        }

    captured = {}

    async def capture_final_response(message, state, _history, _language, updated_fields, missing_fields, _validation_errors, _ambiguity_notes, _owned_sites):
        captured["updated_fields"] = list(updated_fields)
        captured["state"] = state.model_dump(mode="json")
        captured["missing_fields"] = list(missing_fields)
        return "I’ve added Maharashtrian food preparation to the required skills."

    monkeypatch.setattr(JobAssistantService, "_call_gemini", fake_gemini)
    monkeypatch.setattr(JobAssistantService, "_call_final_gemini", capture_final_response)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GEMINI_MODEL", "test-model")

    response = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(
            message="aur unhe maharashtrian food bhi banana aata ho",
            conversation_id=conversation_id,
        ),
    )

    assert response.structured_state.required_skills == [
        "South Indian cooking",
        "Breakfast preparation",
        "Maharashtrian food preparation",
    ]
    assert response.ready_to_create is True
    assert any("skill 'Maharashtrian food preparation'" in field for field in captured["updated_fields"])
    assert "Maharashtrian food preparation" in captured["state"]["required_skills"]
    assert "required_skills" not in captured["missing_fields"]


def test_confirmation_token_cannot_be_reused_for_another_user_or_conversation():
    state = JobAssistantState(
        title="Chef",
        headcount_required=2,
        max_daily_salary=800,
        work_duration_days=10,
        work_timing="8 AM to 5 PM",
        job_site_id=OWNED_SITE_ID,
    )
    token = JobAssistantService._confirmation_token(EMPLOYER_USER, "conversation-1", state)

    valid = JobAssistantService._state_from_confirmation(
        EMPLOYER_USER,
        JobAssistantCreateRequest(
            conversation_id="conversation-1",
            confirmation_token=token,
        ),
    )
    assert valid == state

    with pytest.raises(ValueError, match="INVALID_CONFIRMATION"):
        JobAssistantService._state_from_confirmation(
            EMPLOYER_USER,
            JobAssistantCreateRequest(
                conversation_id="conversation-2",
                confirmation_token=token,
            ),
        )


@pytest.mark.asyncio
async def test_zero_experience_and_optional_skills_are_valid(mock_db):
    """Zero experience (fresher/no experience required) and empty skills are completely valid and ready to create."""
    state = JobAssistantState(
        title="General Helper",
        headcount_required=5,
        job_site_id=OWNED_SITE_ID,
        max_daily_salary=600.0,
        work_duration_days=15,
        work_timing="9:00 AM to 6:00 PM",
        min_experience=0,
        required_skills=[],
    )
    conversation_id = seed_conversation(mock_db, state)
    res_state, missing_fields, invalid_fields, validation_errors, ready, token, revision = JobAssistantService.update_manual_state(
        EMPLOYER_USER,
        JobAssistantStateUpdateRequest(
            conversation_id=conversation_id,
            state=state,
            state_revision=0,
        ),
    )
    assert not missing_fields
    assert not invalid_fields
    assert not validation_errors
    assert ready is True
    assert token is not None
    assert res_state.min_experience == 0


@pytest.mark.asyncio
async def test_ai_fresher_phrase_sets_zero_experience_and_is_valid(mock_db):
    """AI natural expression 'no experience required' sets min_experience=0."""
    state = JobAssistantState(
        title="Helper",
        headcount_required=3,
        job_site_id=OWNED_SITE_ID,
        max_daily_salary=600.0,
        work_duration_days=10,
        work_timing="9:00 AM to 6:00 PM",
    )
    conversation_id = seed_conversation(mock_db, state)
    response = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="No experience required", conversation_id=conversation_id),
    )
    assert response.structured_state.min_experience == 0
    assert not response.validation_errors
    assert "min_experience" not in response.missing_fields
    assert response.ready_to_create is True


@pytest.mark.asyncio
async def test_ambiguous_duration_without_unit_clarification(mock_db):
    """Saying 'for 10' or '10' without duration unit prompts for clarification."""
    state = JobAssistantState(title="Painter", headcount_required=2)
    conversation_id = seed_conversation(mock_db, state)
    response = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="for 10", conversation_id=conversation_id),
    )
    assert response.ready_to_create is False
    assert response.structured_state.work_duration_days is None
    assert any("How long is the job — 10 days, 10 months, or another duration?" in err for err in response.validation_errors)


@pytest.mark.asyncio
async def test_manual_state_update_reports_invalid_fields(mock_db):
    """Manual update with invalid timing, fractional experience < 1, and unauthorized site reports invalid_fields."""
    conversation_id = seed_conversation(mock_db, JobAssistantState())
    state, missing_fields, invalid_fields, validation_errors, ready, token, revision = JobAssistantService.update_manual_state(
        EMPLOYER_USER,
        JobAssistantStateUpdateRequest(
            conversation_id=conversation_id,
            state=JobAssistantState(
                title="Cook",
                headcount_required=5,
                max_daily_salary=800.0,
                work_timing="invalid hours",
                min_experience=0.5,
                work_duration_days=10,
                job_site_id=OTHER_SITE_ID,
            ),
            state_revision=0,
        ),
    )
    assert ready is False
    assert token is None
    assert "work_timing" in invalid_fields
    assert "min_experience" in invalid_fields
    assert "job_site_id" in invalid_fields
    assert len(validation_errors) >= 3

