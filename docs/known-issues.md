# Known issues & technical debt

Security items are described at a high level only. Status as re-verified on 2026-10-31
(commit aabb165). Origin: docs/audits/2026-10-22-codebase-audit.md unless noted.
Severity: Critical / High / Medium / Low. Status: Open / Partial / Fixed.

| ID | Sev | Area | Issue | Status / next step |
|---|---|---|---|---|
| KI-01 | High | Mobile signing | An Android signing password was committed (commit dc653c8) and remains in public git history. | Partial — removed from code in 3c21127; rotate password/upload key (needs owner + Play Console). |
| KI-02 | Critical | DB functions | 30 migrations in 001–069 revoke SECURITY DEFINER function EXECUTE only from PUBLIC, and those functions trust caller-supplied IDs (incl. payment-success and job-acceptance RPCs). | Open — new migration revoking from `anon, authenticated`; confirm live grants first. |
| KI-03 | Critical | DB functions | `execute_user_account_deletion` (102) is granted to `authenticated`, has no caller check or fixed search_path. Currently fails at runtime (references non-existent tables). | Open — restrict to service_role, add search_path, fix table names. |
| KI-04 | Medium | RLS | `job_matching_runs` (059) never enables RLS. | Open |
| KI-05 | Medium | Sessions | Revocation is checked only when the session-key header is sent; logout doesn't invalidate the cookie JWT. | Open |
| KI-06 | Medium | RLS | `user_sessions` policies (031) let users update their own rows, including the revoked flag. | Open |
| KI-07 | Medium | CORS/cookies | Localhost origins are always allowed; credentialed CORS with `SameSite=None` cookie in production. | Open — env-gate dev origins. |
| KI-08 | Medium | Auth | No backend rate limiting on OTP/login endpoints. | Open |
| KI-09 | Medium | Migrations | 029 references a column that doesn't exist on `worker_current_locations` (fresh replay fails); duplicate numbers 031/044/058/068/069. | Open |
| KI-10 | Medium | Connectors | OAuth tokens stored in plaintext; table defined outside the migrations folder (`gleska-backend-f/migrations/connectors_setup.sql`). OAuth callback always returns to `/employer/connectors`. | Open |
| KI-11 | Low | Secrets hygiene | `.gitignore` doesn't cover `google-services.json` or service-account JSON (none tracked today). | Open — proposal |
| KI-12 | Low | API | Inconsistent error `detail` (codes vs sentences); some routes take raw `dict` bodies (e.g. MSG91 login). | Open |
| KI-13 | Low | Android | Windows `org.gradle.java.home` in gradle.properties; `allowBackup=true`; release minify off; lint disabled. | Open |
| KI-14 | Low | Website | `/employer-preview` serves mock data publicly. | Open |
| KI-15 | Low | Tooling | No CI; old pinned backend deps (Python 3.13 incompatible); no secret scanning. | Open |
| KI-16 | Low | Tech debt | Web/mobile code duplicated; files of 2.5–3.6k lines; stray root `package.json` and `mobile/mobile/`; `next-intl` unused. | Open |
| KI-17 | Info | Tests | Pre-existing failures: backend 43 + 4 errors, vitest 3 (worker location). | Open |
| KI-18 | Medium | Website routing | `/general-work` missing from post-login allow-list sent employers to `/`. | Fixed — aabb165, test `src/lib/auth-routing.test.ts` |
| KI-19 | Medium | Account deletion | Deletion removes profile photos from bucket `worker-profile-photos`, but photos are stored in `profile-photos` (`app/services/profile_photo_service.py`), so photos survived account deletion (DPDP). | Fixed 2026-10-31 — shared `PROFILE_PHOTOS_BUCKET` constant, test `tests/test_delete_account.py`. Photos of accounts deleted before the fix may still be in the bucket (cleanup needs the owner). |
| KI-20 | High | Aadhaar verification | Submit-OTP was rejected by Cashfree with `validation_error` "Bad request, please check API documentation" (production record 2026-10-31 08:42 UTC). Cashfree returns `ref_id` as a JSON **string** (production record 2026-10-04); commit 3d70294 began converting it to an integer. Failures also erased the stored `ref_id` and were not logged. | Fixed 2026-10-31 — `ref_id` sent back unchanged, kept after failure/timeout, sanitized error logging + `http_status`, 6-digit OTP validation (backend + UI); tests in `tests/test_cashfree_verification.py`. Confirmed in production 2026-10-31 10:45 UTC: request accepted (no validation_error); `ref_id`/`http_status` now stored. |
| KI-21 | Medium | Aadhaar data (DPDP) | On successful Aadhaar verification, `provider_metadata` keeps the provider response minus a few keys, so personal details (e.g. name, DOB, address, photo link) are likely stored in `employer_verifications` [A from code]. | Open — store only the fields needed (name match, status). |
| KI-22 | Low | Aadhaar UX | After a Submit-OTP timeout the record stays PENDING with its `ref_id`, but the UI only shows the OTP box for reason `OTP_SENT`, so users must request a new OTP. Cashfree help pages also suggest OTP-based Aadhaar may be discontinued in favour of DigiLocker [?]. 2026-10-31 10:45 UTC: Cashfree returned HTTP 502 `internal_error` "Authorised source is temporarily unavailable" (upstream UIDAI source down, not GLESKA code). If it persists, raise with Cashfree support / evaluate DigiLocker. | Open |
| KI-23 | High | AI billing rollout | Enforcement is immediate (owner decision): once migration 104 + the gateway deploy, every AI feature refuses requests until a verified price, FX rate and credits exist. | Open — keep off `main` until increments 2–4 ship; then configure prices before deploy. |
| KI-24 | Medium | AI billing | No automated reconciliation yet: reservations left `held` (provider returned no usage, or settlement failed) need admin review; no provider billing-export import. | Open — increment 4. |

## General Work limitations (2026-10-30)
- Chat answers don't use connectors/plugins; no image generation provider (Library supports
  `generated` files once one exists).
- Only the current message's attachments are sent to Gemini; earlier ones are referenced by name.
- Firefox voice uses server transcription of WebM/Ogg audio — not verified against live Gemini.
