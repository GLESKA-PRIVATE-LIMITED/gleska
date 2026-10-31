# Gleska

Gleska is a platform connecting workers with employers through worker profiles, employer workflows, job publishing, and location-aware job discovery.

## Repository structure

```text
gleska/
├── gleska-website/
│   └── Single Next.js website with role-based worker and employer flows
├── mobile/
│   └── Shared source that builds separate GLESKA Worker and GLESKA Employer apps
├── gleska-backend-f/
│   └── FastAPI backend shared by the website and both mobile apps
│
├── .gitignore
└── README.md
```

## Frontend

The website is one Next.js application written in TypeScript. It uses Tailwind CSS, Supabase authentication, Axios-based backend API integration, and role-specific worker and employer routes.

```bash
cd gleska-website
npm install
npm run dev
```

Validation commands:

```bash
npm run lint
npx tsc --noEmit
```

The mobile worker and employer apps have separate Android application IDs, navigation, and role-specific route trees. See [mobile/README.md](./mobile/README.md) for target build, Capacitor sync, OAuth redirect, and Android flavor commands.

## Backend

The backend is a Python FastAPI service using Pydantic settings, Supabase/PostgreSQL, Supabase authentication, worker and employer profiles, jobs, job sites, employer verification, and matching services. Database schema and matching functions are maintained in the SQL migrations under `gleska-website/supabase/migrations/`, including PostGIS geographic calculations.

```bash
cd gleska-backend-f
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Run the backend tests and import/syntax checks with:

```bash
pytest -q
python -m compileall -q app
```

## AI / LLM

Gemini is used only for natural-language job extraction:

```text
AI/LLM
→ Natural-language job extraction
→ Structured, Pydantic-validated job fields
```

The backend exposes the employer-protected `POST /api/v1/jobs/nlp` endpoint. Gemini returns structured fields including title, headcount, experience, salary, description, location, job type, skills, gender requirement, timing, accommodation, food, and other requirements. The API key, model, and timeout are configured server-side with `GEMINI_API_KEY`, `GEMINI_MODEL`, and `GEMINI_TIMEOUT_SECONDS`.

## AI Assistant connectors

The Hiring agent (`/employer/dashboard`) and General Work workspace (`/general-work`)
share a plug-and-play connector system that lets the AI act on external services
on behalf of the signed-in employer. The provider list, connect/disconnect, and
OAuth flow live under `/employer/connectors`.

Supported providers (configured per employer, server-side credentials in `.env`):

| Group | Providers | Mechanism |
|---|---|---|
| Document intelligence | OCR | Gemini (always on) |
| Candidate communication | WhatsApp, Gmail, Outlook, LinkedIn | WhatsApp via MSG91 (always on); others OAuth |
| Scheduling | Google Calendar, Zoom | OAuth |
| Google Workspace | Drive, Docs, Sheets, Forms | OAuth (same Google client) |
| Microsoft 365 | Outlook, Teams, Excel/OneDrive | OAuth (shared Microsoft client); Teams also supports webhook |
| Team notifications | Slack, Microsoft Teams | Slack OAuth; Teams webhook URL |
| Social media | Facebook, Instagram | OAuth (shared Facebook client) |
| Developer portfolio | GitHub | Public API (always on) |
| Accounting | TallyPrime | Local XML server URL |

OAuth tokens are stored in `connector_tokens` (RLS-scoped per employer). Init /
callback endpoints live at `/api/v1/connectors/oauth/{provider}/init|callback`;
the browser is redirected to the provider's consent screen and back to
`/employer/connectors?connected={provider}` on success.

File uploads from the chat go to the private `assistant-uploads` Supabase bucket
(25 MB cap, extension allowlist). Voice input uses the browser Web Speech API
for the Hiring chat and the backend `POST /api/v1/general-work/transcribe`
endpoint for the General Work chat.

Setup migrations:
- `gleska-backend-f/migrations/connectors_setup.sql` — `connector_tokens` table
  and `assistant-uploads` bucket.
- `gleska-website/supabase/migrations/103_general_work_workspace.sql` — General
  Work projects, conversations, messages, files.

## Matching/Search

Matching is deterministic business logic, not an LLM feature:

```text
Matching/Search
→ Deterministic business rules
→ PostGIS geographic matching
```

The canonical worker matching flow is:

```text
users
 ↓
worker_profiles
 ↓
worker location
 ↓
PostGIS
 ↓
job_sites
 ↓
jobs
 ↓
job_matches
 ↓
worker available-jobs API
```

Migration `011_canonical_worker_profile_matching.sql` adds `job_matches.worker_profile_id`, a uniqueness constraint for profile/job pairs, and RPCs for creating matches and finding available jobs. The current rules require a completed, available worker profile with a trade, coordinates, matching trade/title, sufficient experience, and an expected wage within the job salary when both are supplied. Results are limited to 30,000 meters; available jobs must be in `SEARCHING` status and are ordered by distance. Existing matches are excluded. This documentation does not claim that a positive production match has been tested.

## Supabase

Apply the SQL files in `gleska-website/supabase/migrations/` through the project's existing Supabase workflow. The backend documentation supports `supabase db push` when using the Supabase CLI, or running the migration files manually in the Supabase SQL Editor. Do not commit local credentials or production data.

## Environment

Copy `gleska-website/.env.example` and `gleska-backend-f/.env.example` to local `.env` files as appropriate. The root `.gitignore` protects environment files, generated dependencies, caches, logs, local databases, and private keys while keeping example files and source migrations visible to Git.