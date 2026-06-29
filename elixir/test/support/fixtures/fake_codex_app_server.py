#!/usr/bin/env python3
import json
import sys


def write(payload):
    print(json.dumps(payload), flush=True)


for line in sys.stdin:
    try:
        message = json.loads(line)
    except json.JSONDecodeError:
        continue

    method = message.get("method")
    request_id = message.get("id")

    if method == "initialize":
        write({"id": request_id, "result": {"userAgent": "fake-codex/0.0.0"}})
    elif method == "initialized":
        continue
    elif method == "thread/start":
        write({"id": request_id, "result": {"thread": {"id": "thread-1"}}})
    elif method == "turn/start":
        write({"id": request_id, "result": {"turn": {"id": "turn-1"}}})
        print(
            "2026-06-27T05:18:53.815267Z ERROR codex_models_manager::manager: "
            "failed to refresh available models: timeout waiting for child process to exit",
            flush=True,
        )
        write({"method": "item/agentMessage/delta", "params": {"delta": "ok"}})
        write({"method": "turn/completed", "params": {"usage": {"input_tokens": 1, "output_tokens": 1}}})
        break
