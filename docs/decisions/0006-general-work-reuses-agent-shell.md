# ADR 0006: General Work reuses the agent shell, connectors and upload bucket

- Status: Accepted
- Date: 2026-10-30 (commit aabb165)

## Context
General Work needed a ChatGPT-style workspace without a separate app or auth system.

## Decision
Extend `AgentLayout`/`AgentSidebar` with backwards-compatible `workspace` and `sidebarContent`
props; extract connectors UI into `src/components/connectors/`; store files in the existing private
`assistant-uploads` bucket under `<user_id>/general-work/`; persist chats in four new tables
(migration 103, backend-only writes, owner-read RLS). Sends are idempotent via `client_message_id`.

## Consequences
One shell for all agents; plugins page stays truthful to the Hiring-agent connector system.
Generated images and plugin use inside General Work need future work.
