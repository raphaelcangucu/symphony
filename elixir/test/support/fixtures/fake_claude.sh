#!/usr/bin/env bash
# Fake `claude --print --output-format stream-json` for tests.
# Modes via FAKE_CLAUDE_MODE: happy (default) | error | hang | multi | silent
prompt="$(cat)"
case "${FAKE_CLAUDE_MODE:-happy}" in
  happy)
    echo '{"type":"system","subtype":"init","session_id":"sess-123"}'
    echo '{"type":"assistant","is_partial":true,"message":{"id":"m1","content":[{"type":"text","text":"Hel"}]}}'
    echo '{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Hello from fake claude"}]}}'
    echo '{"type":"assistant","message":{"id":"m2","content":[{"type":"tool_use","id":"tu1","name":"mcp__symphony__list_issues","input":{"limit":1}}]}}'
    echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":[{"type":"text","text":"ok"}],"is_error":false}]}}'
    echo '{"type":"result","subtype":"success","session_id":"sess-123","usage":{"input_tokens":10,"output_tokens":5},"total_cost_usd":0.01}'
    ;;
  error)
    echo '{"type":"result","subtype":"error","error":"boom"}'
    exit 1
    ;;
  hang)
    sleep 60
    ;;
  multi)
    echo '{"type":"system","subtype":"init","session_id":"sess-multi"}'
    echo '{"type":"assistant","is_partial":true,"message":{"id":"m1","content":[{"type":"text","text":"Hel"}]}}'
    echo '{"type":"assistant","is_partial":true,"message":{"id":"m1","content":[{"type":"text","text":"Hello wor"}]}}'
    echo '{"type":"stream_event","stream_event":{"type":"message_delta","usage":{"input_tokens":7,"output_tokens":3}}}'
    echo '{"type":"rate_limit_event","rate_limit_info":{"status":"ok","utilization":12}}'
    echo '{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Hello world"}]}}'
    echo '{"type":"result","subtype":"success","session_id":"sess-multi","usage":{"input_tokens":7,"output_tokens":3}}'
    ;;
  silent)
    # Turn completes successfully but emits no assistant text (exercises the empty-reply fallback).
    echo '{"type":"system","subtype":"init","session_id":"sess-silent"}'
    echo '{"type":"result","subtype":"success","session_id":"sess-silent","usage":{"input_tokens":1,"output_tokens":0},"total_cost_usd":0.0}'
    ;;
esac
