# Gemini integration audit — 2026-10-31

Phase 1 of the central AI gateway & credit billing project (ADR 0007). Read-only audit of
`gleska-backend-f/`, `gleska-website/`, `mobile/` at commit ca294e4.

## Summary
- **7 direct Gemini call sites, all in the backend.** No frontend/mobile Gemini key or call
  (the only frontend mention is a comment in `ProcurementAgentPage.tsx`).
- One key (`GEMINI_API_KEY`) and one model (`GEMINI_MODEL`) from `app/core/config.py`, shared by
  every call. Key sent in the `x-goog-api-key` header (never in URLs).
- Transport: raw `httpx` POST to `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`.
  No SDK, **no streaming**, **no `usageMetadata` captured anywhere**, no embeddings, no audio
  output. One background path (FastAPI `BackgroundTasks` for invoice scans).
- Agents with no AI calls today: Logistics, Tender Filing, Tender Tracking, Industrial
  Maintenance (UI only).

## Call sites
| # | File · function | Agent / operation | Caller(s) | Request | Notes |
|---|---|---|---|---|---|
| G1 | `app/llm/providers.py` · `GeminiLLMProvider.generate_agent_response` | Shared agent runtime: **Hiring** (`hiring_agent_service`, via `_GroundedHiringProvider` → `AgentRuntime`), **Financial agent** (`financial_agent_service` → `AgentRuntime`), **Procurement** (`procurement_agent_service` line ~133, direct) | Employer chat endpoints | JSON-mode, temperature 0, tool calls in loop (≤4 iterations per turn) | Several provider calls per user turn |
| G2 | `app/services/gemini_service.py` · `GeminiService.extract_job_requirements` | **Hiring** – job NLP extraction | `routers/jobs.py` `POST /jobs/nlp`; `GeminiLLMProvider.generate` | Structured JSON | |
| G3 | `app/services/job_assistant_service.py` · `_call_gemini` | **Hiring** – job assistant turn | `JobAssistantService` (line ~997) | `responseSchema` JSON | |
| G4 | `app/services/job_assistant_service.py` · `_call_final_gemini` | **Hiring** – job assistant final answer | same service | JSON | Conditional second call per turn |
| G5 | `app/services/financial_scan_service.py` · `_extract` | **Financial** – invoice scan/OCR | `routers/financial.py` via `BackgroundTasks` (`process_scan`) | Multimodal (inline data or Files API upload, then `generateContent`) | Background; attribution must be passed explicitly |
| G6 | `app/services/connectors/ocr_service.py` · `_handle_with_gemini` | **Hiring** – connector tool `analyze_document` | `hiring_agent_service` tool executor | Multimodal | Tool call inside an agent turn |
| G7 | `app/services/general_work_ai_service.py` · `_generate` (reply + transcription) | **General Work** – chat, voice transcription | `general_work_service.send_message`, `routers/general_work.transcribe` | Multimodal, Markdown | |

Config-only reference: `financial_service._financial_settings_response` reads `GEMINI_*` to report
whether scanning is configured (no call).

## Error handling today
Each site maps httpx timeouts/HTTP errors to its own error codes; none retries automatically except
the agent runtime loop. No call records cost or tokens, so historic usage cannot be reconstructed.

## Existing infrastructure to reuse
- Organisation = `employer_profiles` (one per employer user); role checks `require_employer` / `require_admin`.
- Payments: Cashfree PG via `cashfree_payment_service` (order creation, status, webhook signature
  verification) and `routers/payments.py` webhook; table `payment_transactions` (1 row in production).
- UI shells: employer `components/AccountManagementShell.tsx` (sidebar), admin `components/admin/AdminShell.tsx`.

## Production snapshot (Supabase "WEBSITE FINAL", read-only)
2 employer profiles, 3 users, 1 payment transaction; no billing/credit tables exist. Advisor flags
`public.spatial_ref_sys` (PostGIS system table) without RLS.
