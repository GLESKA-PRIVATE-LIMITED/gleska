# Company Brain — Evaluation Report

Date: 2026-10-31. Harness: `gleska-backend-f/tests/company_brain_eval.py` (also run by
`tests/test_company_brain_eval.py`). Ground truth: `tests/company_brain_fixtures.py` — two
organisations, hand-written records, every expected value computed by hand (comments show the sums).

## Method
- Real code under test: tools, data access allowlist, Decimal calculations, period logic, pipeline,
  keyword planner, validator, answer fallback, document evidence handling.
- The language model is replaced by scripted stand-ins: a *faithful* model (restates evidence), a
  *hallucinating* model (invents ₹98,76,543.21 and "23%"), and an *injection-obeying* model.
- Database: in-memory fake with PostgREST-like filters; SQL-level parts (RLS, hybrid search
  ranking, version filtering) are covered separately by `supabase/tests/106_company_brain_test.sql`
  on Postgres 16 + pgvector.

## Results (44 cases, 44 passed)
| Category | Passed | What it checks |
|---|---|---|
| HR / workforce | 5/5 | active, engaged, pending, unfilled positions, wage upper bound |
| Attendance | 2/2 | late and absent counts in period |
| Finance | 7/7 | invoiced INR/USD, received, outstanding, overdue, supplier bills, platform payments |
| Procurement | 4/4 | open commitments, awaiting supplier, delivered, delayed deliveries |
| Logistics | 1/1 | dispatched vehicle listings |
| Cross-agent | 1/1 | procurement + workforce + logistics in one plan, no double counting |
| Trend | 1/1 | month-to-date vs same days last month: +740.0% |
| Routing (keyword planner) | 11/11 | required tools selected |
| Abstention | 5/5 | tenders, maintenance, payroll, departments, payables → "couldn't verify" + reason, no figures |
| Hallucination / citations | 2/2 | faithful answer validated; invented figures rejected → evidence-only fallback |
| Security | 5/5 | org isolation, model-supplied org ignored, allowlist blocks, SQL text inert, document injection blocked |

| Metric | Value | Note |
|---|---|---|
| Numerical accuracy | 21/21 | exact Decimal equality with hand-computed values |
| Tool-routing recall (fallback planner) | 12/12 | |
| Tool-routing precision (fallback planner) | 12/20 | the keyword fallback over-fetches (extra evidence, never wrong data) |
| Citation accuracy | 2/2 | every citation exists; fake `[E99]` rejected (service test) |
| Abstention | 5/5 | |

Additional automated tests: 13 tool tests, 18 service/API tests, 9 document tests, 4 logistics API
tests, 5 UI tests, SQL tests for migrations 106/107. Backend suite: 586 passed (was 541);
the 43 failures/4 errors are the pre-existing baseline.

## Not covered (honest limits)
1. **Live Gemini planning and wording quality** — not measured: this environment has no Gemini
   access. Planner mistakes are contained (validated arguments, keyword fallback, validator), but the
   rate of wrong tool choices on real questions is unknown. Run the same questions against a test
   organisation after deployment and record results here.
2. **Embedding retrieval quality** (precision/recall of semantic search on real documents) — needs
   the embedding model price configured and real documents.
3. Scale tests (thousands of documents, 5,000-row caps) — not run.
4. No claim of 100% accuracy is made: the dataset is small (two organisations, ~40 records).
