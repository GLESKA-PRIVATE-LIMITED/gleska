import pytest
from pydantic import ValidationError

from app.schemas.procurement import MaterialRequestDraft, ProcurementDraftUpdateRequest
from app.services.procurement_service import (
    _cleared_fields_after_user_edit,
    _merge_model_draft_proposal,
)


def test_model_proposal_does_not_repopulate_intentionally_cleared_field():
    merged = _merge_model_draft_proposal(
        {"item_name": None, "notes": None},
        {"item_name": "Portland cement", "notes": "User-requested packaging"},
        {"item_name"},
    )

    assert merged == {"item_name": None, "notes": "User-requested packaging"}


def test_model_proposal_does_not_repopulate_cleared_list_field():
    merged = _merge_model_draft_proposal(
        {"additional_requirements": []},
        {"additional_requirements": ["Palletized delivery"]},
        {"additional_requirements"},
    )

    assert merged["additional_requirements"] == []


def test_model_proposal_can_fill_field_that_was_never_populated():
    merged = _merge_model_draft_proposal(
        {"item_name": None},
        {"item_name": "Portland cement"},
        set(),
    )

    assert merged["item_name"] == "Portland cement"


def test_existing_draft_value_is_not_overwritten_by_model_proposal():
    merged = _merge_model_draft_proposal(
        {"item_name": "OPC 53 cement"},
        {"item_name": "Portland cement"},
        set(),
    )

    assert merged["item_name"] == "OPC 53 cement"


def test_explicit_user_value_restores_field_and_removes_clear_marker():
    cleared_fields = _cleared_fields_after_user_edit(
        {"item_name": None},
        {"item_name": "Portland cement"},
        ["item_name"],
        ["item_name"],
    )

    assert cleared_fields == []


def test_legacy_edit_that_clears_populated_field_creates_marker():
    cleared_fields = _cleared_fields_after_user_edit(
        {"item_name": "OPC 53 cement"},
        {"item_name": None},
        [],
        [],
    )

    assert cleared_fields == ["item_name"]


def test_draft_update_rejects_cleared_marker_for_populated_or_confirmed_field():
    draft = MaterialRequestDraft(item_name="Portland cement")

    with pytest.raises(ValidationError):
        ProcurementDraftUpdateRequest(
            draft=draft,
            confirmed_fields=[],
            cleared_fields=["item_name"],
            expected_revision=1,
        )

    with pytest.raises(ValidationError):
        ProcurementDraftUpdateRequest(
            draft=MaterialRequestDraft(item_name=None),
            confirmed_fields=["item_name"],
            cleared_fields=["item_name"],
            expected_revision=1,
        )
