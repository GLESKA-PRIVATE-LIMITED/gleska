from app.core.config import settings
from app.services.verification_service import VerificationService


def test_verification_requirements_are_type_specific(monkeypatch):
    monkeypatch.setattr(
        settings,
        "EMPLOYER_REQUIRED_VERIFICATIONS",
        "REGISTERED_INDUSTRY:GSTIN|REGISTRATION_NUMBER;REGISTERED_BUSINESS:GSTIN;UNREGISTERED_BUSINESS:AADHAAR",
    )

    assert VerificationService.required_for("INDIVIDUAL") == []
    assert VerificationService.required_for("UNREGISTERED_BUSINESS") == ["AADHAAR"]
    assert VerificationService.required_for("REGISTERED_BUSINESS") == ["GSTIN"]
    assert VerificationService.required_for("REGISTERED_INDUSTRY") == ["CIN"]
    assert VerificationService.required_for("REGISTERED_INDUSTRY", {"gstin": ""}) == ["CIN"]
    assert VerificationService.required_for("REGISTERED_INDUSTRY", {"gstin": "29AAICP2912R1ZR"}) == ["CIN", "GSTIN"]
