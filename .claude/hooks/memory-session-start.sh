#!/usr/bin/env bash
# SessionStart hook: remember where this session began (for memory-stop-check.sh) and warn when
# code changed after the project memory (docs/project-status.md) was last updated — e.g. work
# merged from other tools or developers. Output is added to Claude's context. Needs only bash + git.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git rev-parse HEAD > "$(git rev-parse --git-path claude-memory-session-start)" 2>/dev/null

base=$(git log -1 --format=%h -- docs/project-status.md 2>/dev/null)
[ -n "$base" ] || exit 0
changed=$(git diff --name-only "$base" HEAD -- . ':(exclude)docs' ':(exclude,glob)**/CLAUDE.md' ':(exclude).claude' \
  | awk -F/ '{print (NF > 2) ? $1"/"$2"/"$3 : $0}' | sort -u)
[ -n "$changed" ] || exit 0

commits=$(git rev-list --count "$base"..HEAD)
echo "Project memory check: $commits commit(s) changed code after the memory was last updated (commit $base)."
echo "Areas changed since then:"
echo "$changed" | head -20 | sed 's/^/  - /'
[ "$(echo "$changed" | wc -l)" -gt 20 ] && echo "  - …"
echo "Before relying on CLAUDE.md or docs/ for these areas, re-check them; then update the affected"
echo "docs (project-status, known-issues, architecture, component CLAUDE.md) and their 'Last verified' lines."
exit 0
