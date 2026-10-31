# Project status

Last verified: 2026-10-31, commit aabb165. Update at the end of every task.

## Done (verified in code)
- Worker/employer accounts: Supabase + MSG91 OTP auth, onboarding, verification (Cashfree), terms.
- Jobs, job sites, PostGIS matching, attendance, subscriptions/payments (Cashfree), notifications.
- Hiring agent with connector tools and OAuth connectors page.
- Procurement (buyer + supplier, RFQ/quotes/POs) and Financial agent (invoices, scans, audits).
- Account deletion feature (backend fallback path; DB function broken — KI-03).
- Android release signing from env/untracked file (3c21127).
- General Work workspace (aabb165): chat, attachments, camera, voice, library, projects, plugins.
  Tests: backend `tests/test_general_work.py`, web `gleska-website/src/components/agents/general-work/generalWork.test.tsx`.

## Waiting on the owner
- Apply migration `103_general_work_workspace.sql`; set `GEMINI_API_KEY`; confirm `assistant-uploads` bucket.
- Rotate the exposed signing password / upload key (KI-01).

## In progress / partial
- Logistics agent: UI with hard-coded fleet; persistence in localStorage only.

## Planned / not started
- Tender filing & tracking backends (UI placeholders only).
- Security hardening KI-02…KI-08; CI pipeline; dependency upgrades (KI-15).

## Unknown
- Which migrations are applied in production; Play Store release status (docs/open-questions.md).
