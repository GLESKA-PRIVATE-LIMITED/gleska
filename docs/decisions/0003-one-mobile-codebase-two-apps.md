# ADR 0003: One mobile codebase builds separate Worker and Employer apps

- Status: Accepted (recorded from existing code)
- Date: 2026-10-31

## Context
Workers and employers need different navigation and store listings (`mobile/capacitor.config.ts`,
Gradle product flavors `worker`/`employer`).

## Decision
Shared Vite/React/Capacitor source; the build target selects the route tree, app id
(`com.gleska.worker` / `com.gleska.employer`) and OAuth scheme.

## Consequences
Two store apps to release; both depend on the same backend API, so API changes must stay backward
compatible for installed versions.
