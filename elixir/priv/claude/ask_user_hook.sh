#!/usr/bin/env bash
# Symphony PreToolUse hook for Claude Code AskUserQuestion.
# Env:
#   SYMPHONY_ASK_USER_URL          — http://127.0.0.1:<port>/user-input/<token>
#   SYMPHONY_ASK_USER_TIMEOUT_SEC  — curl max-time (default 300)
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"jq is required for AskUserQuestion hook"}}'
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"curl is required for AskUserQuestion hook"}}'
  exit 0
fi

if [[ -z "${SYMPHONY_ASK_USER_URL:-}" ]]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"SYMPHONY_ASK_USER_URL is not set"}}'
  exit 0
fi

INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
if [[ "$TOOL_NAME" != "AskUserQuestion" ]]; then
  exit 0
fi

REQUEST_ID=$(printf '%s' "$INPUT" | jq -r '.tool_use_id // empty')
if [[ -z "$REQUEST_ID" || "$REQUEST_ID" == "null" ]]; then
  REQUEST_ID="ask-$(date +%s)-$$"
fi

QUESTIONS=$(printf '%s' "$INPUT" | jq -c '.tool_input.questions // []')
TIMEOUT_SEC="${SYMPHONY_ASK_USER_TIMEOUT_SEC:-300}"

RESP=$(curl -sS -X POST \
  -H 'content-type: application/json' \
  --max-time "$TIMEOUT_SEC" \
  -d "$(jq -nc --arg id "$REQUEST_ID" --argjson qs "$QUESTIONS" '{request_id:$id, questions:$qs}')" \
  "$SYMPHONY_ASK_USER_URL" || true)

if [[ -z "$RESP" ]]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"AskUserQuestion hook request failed"}}'
  exit 0
fi

DECISION=$(printf '%s' "$RESP" | jq -r '.permissionDecision // empty')
if [[ "$DECISION" == "allow" ]]; then
  UPDATED=$(printf '%s' "$RESP" | jq -c '.updatedInput // {}')
  jq -nc --argjson updated "$UPDATED" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:$updated}}'
  exit 0
fi

REASON=$(printf '%s' "$RESP" | jq -r '.permissionDecisionReason // .error // "Operator input unavailable"')
jq -nc --arg reason "$REASON" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
exit 0
