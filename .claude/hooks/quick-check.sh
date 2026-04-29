#!/usr/bin/env bash
# Stop hook: fast post-turn health check. Runs `go vet` if Go files changed
# since the last check. Skips otherwise. Surfaces failures via stdout, which
# Claude Code includes as context in the next turn so the assistant addresses
# real regressions rather than letting them rot.

set -e

cd "${CLAUDE_PROJECT_DIR:-.}"

state_dir=".claude/state"
mkdir -p "$state_dir"

mark="$state_dir/last-vet.timestamp"

# If the marker exists and no Go file has been modified since, skip.
if [ -f "$mark" ]; then
    if ! find apps/api -name '*.go' -newer "$mark" -print -quit 2>/dev/null | grep -q .; then
        exit 0
    fi
fi

# go isn't installed in every environment (CI, fresh machines). Don't fail.
if ! command -v go >/dev/null 2>&1; then
    exit 0
fi

if output=$(cd apps/api && go vet ./... 2>&1); then
    touch "$mark"
    exit 0
fi

cat <<EOF
Stop-hook health check found a regression.

\`go vet ./...\` in apps/api failed. Recent edits introduced an issue that needs to be addressed before declaring the turn complete.

Output:

$output

Suggested next step: re-read the failing files and fix the underlying issue rather than suppressing the warning.
EOF

exit 0
