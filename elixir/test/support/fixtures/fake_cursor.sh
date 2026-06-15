#!/usr/bin/env bash
# Fake `cursor-agent --print --output-format stream-json --stream-partial-output` for tests.
# Modes via FAKE_CURSOR_MODE: happy (default) | error | hang | multi | silent | resume-aware
prompt="$(cat)"
case "${FAKE_CURSOR_MODE:-happy}" in
  happy)
    echo '{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/tmp","session_id":"chat-123","model":"Composer 1","permissionMode":"default"}'
    echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"do the thing"}]},"session_id":"chat-123"}'
    echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hel"}]},"session_id":"chat-123","timestamp_ms":1}'
    echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello from fake cursor"}]},"session_id":"chat-123"}'
    echo '{"type":"tool_call","subtype":"started","call_id":"tc1","tool_call":{"function":{"name":"mcp__symphony__list_issues","arguments":"{\"limit\":1}"}},"session_id":"chat-123"}'
    echo '{"type":"tool_call","subtype":"completed","call_id":"tc1","tool_call":{"function":{"name":"mcp__symphony__list_issues","arguments":"{\"limit\":1}","result":"ok"}},"session_id":"chat-123"}'
    echo '{"type":"result","subtype":"success","duration_ms":12,"duration_api_ms":12,"is_error":false,"result":"Hello from fake cursor","session_id":"chat-123","usage":{"inputTokens":1200,"outputTokens":340,"totalTokens":1540}}'
    ;;
  error)
    echo '{"type":"result","subtype":"error","is_error":true,"result":"boom","session_id":"chat-err"}'
    exit 1
    ;;
  hang)
    sleep 60
    ;;
  multi)
    echo '{"type":"system","subtype":"init","session_id":"chat-multi"}'
    echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hel"}]},"session_id":"chat-multi","timestamp_ms":1}'
    echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"lo wor"}]},"session_id":"chat-multi","timestamp_ms":2}'
    echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello wor"}]},"session_id":"chat-multi","timestamp_ms":3,"model_call_id":"mc1"}'
    echo '{"type":"tool_call","subtype":"started","call_id":"tc1","tool_call":{"readToolCall":{"args":{"path":"file.txt"}}},"session_id":"chat-multi"}'
    echo '{"type":"tool_call","subtype":"completed","call_id":"tc1","tool_call":{"readToolCall":{"args":{"path":"file.txt"},"result":{"success":{"content":"hi","totalLines":1}}}},"session_id":"chat-multi"}'
    echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello world"}]},"session_id":"chat-multi"}'
    echo '{"type":"result","subtype":"success","is_error":false,"result":"Hello world","session_id":"chat-multi","usage":{"inputTokens":50,"outputTokens":25,"totalTokens":75}}'
    ;;
  silent)
    # Turn completes successfully but emits no assistant text (exercises the empty-reply fallback).
    echo '{"type":"system","subtype":"init","session_id":"chat-silent"}'
    echo '{"type":"result","subtype":"success","is_error":false,"result":"","session_id":"chat-silent"}'
    ;;
  resume-aware)
    # Mimic the real cursor-agent CLI: a `--resume <id>` to a non-existent chat prints
    # a plain error line and exits 1. A fresh turn (no --resume) succeeds.
    if printf '%s\n' "$@" | grep -q -- '--resume'; then
      echo 'Error: chat not found: deadbeef-0000-4000-8000-000000000000'
      exit 1
    fi
    echo '{"type":"system","subtype":"init","session_id":"chat-fresh"}'
    echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"fresh session reply"}]},"session_id":"chat-fresh"}'
    echo '{"type":"result","subtype":"success","is_error":false,"result":"fresh session reply","session_id":"chat-fresh"}'
    ;;
esac
