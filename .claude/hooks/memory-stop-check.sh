#!/usr/bin/env bash
# Stop hook: if this session changed code but did not update the project memory, block stopping
# once and ask Claude to update it. Never blocks twice in a row. Needs only bash + git.
input=$(cat)
case "$input" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;; esac

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
start=$(cat "$(git rev-parse --git-path claude-memory-session-start 2>/dev/null)" 2>/dev/null) || exit 0
git cat-file -e "$start^{commit}" 2>/dev/null || exit 0

# Everything changed since the session started: commits, uncommitted edits and new files.
touched=$( { git diff --name-only "$start"; git ls-files --others --exclude-standard; } | sort -u)
code=$(echo "$touched" | grep -vE '^(docs/|\.claude/)|(^|/)CLAUDE\.md$' | grep -c .)
memory=$(echo "$touched" | grep -cE '^docs/(project-status|known-issues)\.md$')
[ "$code" -gt 0 ] && [ "$memory" -eq 0 ] || exit 0

cat <<JSON
{"decision": "block", "reason": "Project memory not updated: this session changed $code code file(s) but neither docs/project-status.md nor docs/known-issues.md. Following CLAUDE.md section 10, update docs/project-status.md (and known-issues.md, architecture.md, ADRs or the relevant component CLAUDE.md if affected), change 'Last verified' only for sections you re-checked, then finish. If the change truly needs no memory update, say so briefly and stop."}
JSON
exit 0
