# Website (Next.js 16) — component memory

Read the root CLAUDE.md first. Commands and baselines are in its §3.

## Layout
- `src/app/` — App Router. Roles: `worker/*`, `employer/*`, `admin/*`, `supplier/*`; employer
  agents: `procurement`, `financial`, `logistics`, `tender-filing`, `tender-tracking`, `general-work`.
  Agent `page.tsx` files are thin server wrappers around a client component.
- `src/components/agent-dashboard/` — **shared agent shell**: `AgentLayout` (employer-only guard,
  sidebar, `workspace` full-height mode, `sidebarContent` slot), `AgentSidebar`, `types.ts`
  (`AgentConfig`). New agents: config file + `AgentLayout`; don't build a new shell.
- `src/components/agents/<agent>/` — agent-specific code (General Work: chat, library, projects,
  plugins, dialogs; see its files).
- `src/components/connectors/` — shared connectors hook + list (used by `/employer/connectors`
  and General Work Plugins).
- `src/lib/api.ts` — axios client: base URL `NEXT_PUBLIC_API_URL`, adds Supabase bearer +
  `X-Goleska-Session-Key`. Typed per-domain clients: `procurement-api.ts`, `general-work-api.ts`.
- `src/lib/auth-routing.ts` — post-login redirects. **New employer agent routes must be added to
  `EMPLOYER_AGENT_ROUTES`**, or sign-in / homepage cards send users to `/`.
- `src/middleware.ts` — cookie-presence navigation hint; add new protected prefixes + matcher.
- `src/context/` — `AuthContext` (user from `/api/v1/auth/me`), `LanguageContext` (custom i18n via
  `src/lib/translations.ts`; `next-intl` installed but unused).
- `src/lib/useSpeechInput.ts` — reusable voice input (Web Speech API + server transcription fallback).

## Rules
- Client role checks are UX only; the backend enforces access.
- Render AI/user Markdown with `react-markdown` + `remark-gfm`, never raw HTML.
- ESLint `react-hooks/set-state-in-effect` is on: start data loads with promise chains
  (`.then(setX)`), not synchronous `setState` at the top of an effect.
- Multipart uploads: pass `"Content-Type": "multipart/form-data"` (axios then sets the boundary);
  the default JSON header would serialise FormData to JSON.
- Tests: Vitest + Testing Library in `src/**/*.test.tsx`; mock `@/lib/api` or the typed client.

## Gotchas
- `next build` needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (placeholders OK).
- `next dev`/`build` rewrite `next-env.d.ts`; don't commit that churn.
- Next 16 warns that `middleware.ts` is deprecated in favour of `proxy.ts` (not migrated).
- `/employer-preview` serves mock data publicly (KI-14).

Last verified: 2026-10-31, commit aabb165.
