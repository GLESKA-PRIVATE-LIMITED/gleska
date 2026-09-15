"""Unit tests for the conversational job creation assistant."""

from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID
import pytest
from pydantic import ValidationError

from app.schemas.auth import UserResponse
from app.schemas.job import JobCreate
from app.schemas.job_assistant import (
    JobAssistantMessageRequest,
    JobAssistantResponse,
    JobAssistantState,
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

OWNED_SITE_ID = "11111111-1111-1111-1111-111111111111"
OTHER_SITE_ID = "99999999-9999-9999-9999-999999999999"


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
        return SimpleNamespace(data=filtered)


class FakeSupabaseAssistant:
    def __init__(self):
        self.employer_profiles = [{"id": "employer-profile-1", "user_id": "user-123", "onboarding_status": "COMPLETED"}]
        self.job_sites = [
            {"id": OWNED_SITE_ID, "employer_id": "employer-profile-1", "name": "Nanded Site", "address": "Nanded City"},
            {"id": "22222222-2222-2222-2222-222222222222", "employer_id": "employer-profile-1", "name": "Pune Plant", "address": "Pune MIDC"},
        ]

    def table(self, name):
        if name == "employer_profiles":
            return FakeSupabaseTable(self.employer_profiles)
        if name == "job_sites":
            return FakeSupabaseTable(self.job_sites)
        return FakeSupabaseTable([])


@pytest.fixture(autouse=True)
def mock_db(monkeypatch):
    monkeypatch.setattr("app.services.job_assistant_service.supabase", FakeSupabaseAssistant())


@pytest.mark.asyncio
async def test_complete_in_one_message():
    """Employer provides all required information in a single natural-language message."""
    request = JobAssistantMessageRequest(
        message="I need 5 cooks at my Nanded site for 20 days, paying ₹700 per day, 8 AM to 5 PM.",
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
    assert response.ready_to_create is True
    assert len(response.missing_fields) == 0
    assert len(response.validation_errors) == 0


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
        JobAssistantMessageRequest(message="Construction labourers", current_state=turn1.structured_state),
    )
    # Turn 1's headcount must still be 5
    assert turn2.structured_state.headcount_required == 5
    assert turn2.structured_state.title is not None

    # Turn 3: wage
    turn3 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="700 per day", current_state=turn2.structured_state),
    )
    assert turn3.structured_state.max_daily_salary == 700.0
    assert turn3.structured_state.headcount_required == 5

    # Turn 4: duration
    turn4 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(message="For 20 days", current_state=turn3.structured_state),
    )
    assert turn4.structured_state.work_duration_days == 20

    # Turn 5: timing & site
    turn5 = await JobAssistantService.process_message(
        EMPLOYER_USER,
        JobAssistantMessageRequest(
            message="8 AM to 5 PM at Nanded site",
            current_state=turn4.structured_state,
        ),
    )
    assert turn5.structured_state.work_timing is not None
    assert turn5.structured_state.job_site_id == OWNED_SITE_ID
    assert turn5.ready_to_create is True


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
async def test_corrections():
    """User says 'Actually make it 7 workers' and state updates from 5 to 7."""
    initial_state = JobAssistantState(
        title="Cook",
        headcount_required=5,
        max_daily_salary=700.0,
        work_duration_days=20,
        work_timing="8:00 AM – 5:00 PM",
        job_site_id=OWNED_SITE_ID,
    )
    request = JobAssistantMessageRequest(
        message="Actually make it 7 workers",
        current_state=initial_state,
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)

    assert response.structured_state.headcount_required == 7
    # Duration, title, salary, etc. must be preserved
    assert response.structured_state.work_duration_days == 20
    assert response.structured_state.max_daily_salary == 700.0
    assert response.structured_state.title == "Cook"
    assert response.ready_to_create is True


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
async def test_duration_must_not_overwrite_workers():
    """Test 1: 'for 90 days' must set work_duration_days=90 and NOT overwrite headcount_required."""
    initial = JobAssistantState(headcount_required=3, title="Cook")
    request = JobAssistantMessageRequest(
        message="for 90 days",
        current_state=initial,
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)
    assert response.structured_state.headcount_required == 3
    assert response.structured_state.work_duration_days == 90


@pytest.mark.asyncio
async def test_months_conversion():
    """Test 2: 'for 3 months' converts to work_duration_days=90 while headcount remains untouched."""
    initial = JobAssistantState(headcount_required=4, title="Painter")
    request = JobAssistantMessageRequest(
        message="for 3 months",
        current_state=initial,
    )
    response = await JobAssistantService.process_message(EMPLOYER_USER, request)
    assert response.structured_state.work_duration_days == 90
    assert response.structured_state.headcount_required == 4


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
async def test_experience_survives_another_update():
    """Test 4: min_experience is preserved when user later updates a different field."""
    initial = JobAssistantState(
        title="Welder",
        min_experience=1,
        headcount_required=3,
    )
    request = JobAssistantMessageRequest(
        message="Actually I need 8 workers",
        current_state=initial,
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
async def test_full_state_preservation_on_single_field_update():
    """Test 8: Updating one field preserves all other existing valid fields."""
    initial = JobAssistantState(
        title="Chef",
        headcount_required=4,
        max_daily_salary=900.0,
        min_experience=2,
        work_duration_days=60,
        work_timing="9:00 AM – 6:00 PM",
        job_site_id=OWNED_SITE_ID,
        job_site_name="Nanded Site",
    )
    request = JobAssistantMessageRequest(
        message="Change wage to 950 per day",
        current_state=initial,
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
    assert any("cannot be negative" in e.lower() for e in r3.validation_errors)
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
