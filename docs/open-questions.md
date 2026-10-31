# Open questions (not verifiable from the repository)

| # | Question | Why it matters |
|---|---|---|
| Q1 | Which migrations (001–103) are applied in production, and are live function grants as the files say? | Decides the KI-02/03 fix and whether 066's hardening is live. |
| Q2 | Are the Worker/Employer apps published on Google Play, with Play App Signing? Who holds the upload keystore and backup? | KI-01 rotation path. |
| Q3 | Exact production hosts and deploy triggers (Render/Vercel?); separate staging Supabase project? | Safe rollout of migrations and API changes. |
| Q4 | Which Gemini model/quota is configured in production? | General Work and Hiring agent availability/cost. |
| Q5 | Is the `assistant-uploads` bucket (from `connectors_setup.sql`) created in production? | General Work and Hiring uploads. |
| Q6 | Should General Work be employer-only (current) or open to workers? | Access rules. |
| Q7 | Required data-retention periods (DPDP) for chats, uploads and audit tables? | Retention/deletion design. |
