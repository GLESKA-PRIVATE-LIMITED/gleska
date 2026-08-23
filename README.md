# Gleska

Gleska is a platform connecting workers with employers through worker profiles, employer workflows, job publishing, and location-aware job discovery.

## Repository structure

```text
gleska/
├── gleska-website/
│   └── Next.js frontend
│
├── gleska-backend-f/
│   └── FastAPI backend
│
├── .gitignore
└── README.md
```

## Frontend

The frontend is a Next.js application written in TypeScript. It uses Tailwind CSS, Supabase authentication, Axios-based backend API integration, and separate worker and employer dashboard, onboarding, profile, attendance, and worker-management routes.

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