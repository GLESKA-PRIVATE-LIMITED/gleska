# Mobile (Vite + React + Capacitor 8) — component memory

Read the root CLAUDE.md first; build steps are in `mobile/README.md` (not re-documented here).

## Facts
- One source, two Android apps chosen by Vite mode / `CAPACITOR_APP_TARGET`:
  `com.gleska.worker` ("GLESKA Worker") and `com.gleska.employer` ("GLESKA Employer")
  [V `capacitor.config.ts`, `android/app/build.gradle` product flavors].
- Routes per app in `src/App.tsx`; features in `src/features/{auth,worker,employer}`.
- Auth: Supabase PKCE via `Browser.open`, callback `com.gleska.<target>://auth/callback`; API via
  the same backend as the website. Never put the service-role key in `mobile/.env`.
- Release signing: `android/app/release-signing.gradle` (env `GLESKA_UPLOAD_*` or untracked
  `android/keystore.properties`); debug builds need nothing.
- No code is shared with the website (duplicated auth/MSG91/procurement logic, KI-16).

## Rules
- Installed app versions stay in the field: backend changes must stay backward compatible.
- Build and sync one target at a time (both write `dist/`).

## Gotchas
- Android SDK downloads (`dl.google.com`) are blocked in the cloud container — Gradle builds can't
  run there; verify on a developer machine.
- `android/gradle.properties` hard-codes a Windows `org.gradle.java.home` (KI-13).
- `allowBackup="true"`, release minify off, lint disabled (KI-13).
- `mobile/mobile/` is a stray partial npm install.

Last verified: 2026-10-31, commit aabb165.
