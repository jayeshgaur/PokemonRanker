#!/usr/bin/env bash
# PostToolUse hook for Edit|Write. Logs which files were modified so the
# assistant can detect "substantial change" accumulation between gates.
# Cheap, fire-and-forget. Never blocks.

set -e

state_dir="${CLAUDE_PROJECT_DIR:-.}/.claude/state"
mkdir -p "$state_dir"

log="$state_dir/edits.log"
ts="$(date -u +%FT%TZ)"
paths="${CLAUDE_FILE_PATHS:-unknown}"

echo "$ts $paths" >> "$log"
exit 0
