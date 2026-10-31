# ADR 0005: Android release signing credentials live outside the repository

- Status: Accepted
- Date: 2026-10-22 (commit 3c21127)

## Context
A signing password was committed in plain text (KI-01).

## Decision
`mobile/android/app/release-signing.gradle` reads `GLESKA_UPLOAD_*` environment variables or an
untracked `keystore.properties`; release tasks fail with a clear message when values are missing;
debug builds need nothing.

## Consequences
CI must inject the secrets. The exposed password must still be rotated; historical exposure remains.
