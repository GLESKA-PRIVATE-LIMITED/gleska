"""Runs the Company Brain evaluation suite (tests/company_brain_eval.py) as part of the test run."""

import pytest

from tests.company_brain_eval import run_all, summarise


@pytest.mark.asyncio
async def test_evaluation_suite_passes_every_case():
    results = await run_all()
    failures = [(r.category, r.question, r.expected, r.actual, r.reason) for r in results if not r.passed]
    assert failures == [], summarise(results)
    assert len(results) >= 40
