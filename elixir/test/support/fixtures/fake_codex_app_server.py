#!/usr/bin/env python3
import json
import os
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
    elif method == "thread/resume":
        write({"id": request_id, "result": {"thread": {"id": message.get("params", {}).get("threadId", "thread-1")}}})
    elif method == "thread/goal/get":
        write({"id": request_id, "result": {"goal": None}})
    elif method == "thread/goal/set":
        if os.getenv("FAKE_CODEX_GOAL_SET_ERROR") == "1":
            write({"id": request_id, "error": {"code": -32603, "message": "goal set failed"}})
        else:
            params = message.get("params", {})
            write(
                {
                    "id": request_id,
                    "result": {
                        "goal": {
                            "threadId": params.get("threadId"),
                            "objective": params.get("objective"),
                            "status": params.get("status", "active"),
                            "tokenBudget": params.get("tokenBudget"),
                            "tokensUsed": 0,
                            "timeUsedSeconds": 0,
                        }
                    },
                }
            )
    elif method == "turn/start":
        write({"id": request_id, "result": {"turn": {"id": "turn-1"}}})
        print(
            "2026-06-27T05:18:53.815267Z ERROR codex_models_manager::manager: "
            "failed to refresh available models: timeout waiting for child process to exit",
            flush=True,
        )
        if os.getenv("FAKE_CODEX_ORDERED_TIMELINE") == "1":
            write({"method": "item/agentMessage/delta", "params": {"delta": " \n"}})
            write({"method": "item/agentMessage/delta", "params": {"delta": "Before "}})
            write(
                {
                    "method": "item/started",
                    "params": {
                        "item": {
                            "id": "provider-shell-1",
                            "type": "commandExecution",
                            "command": "pwd",
                        }
                    },
                }
            )
            write(
                {
                    "method": "item/completed",
                    "params": {
                        "item": {
                            "id": "provider-shell-1",
                            "type": "commandExecution",
                            "command": "pwd",
                            "status": "completed",
                            "aggregatedOutput": "/tmp/project\n",
                            "exitCode": 0,
                        }
                    },
                }
            )
            write(
                {
                    "id": "dynamic-tool-request-1",
                    "method": "item/tool/call",
                    "params": {
                        "name": "missing_dynamic_tool",
                        "arguments": {"query": "status"},
                    },
                }
            )
            sys.stdin.readline()
            write({"method": "item/agentMessage/delta", "params": {"delta": "after"}})
        else:
            write({"method": "item/agentMessage/delta", "params": {"delta": "ok"}})
        completed_params = {"usage": {"input_tokens": 1, "output_tokens": 1}}
        if os.getenv("FAKE_CODEX_GOAL_EVENT") == "1":
            completed_params["goal"] = {
                "objective": "Audit",
                "status": "active",
                "tokensUsed": 12,
                "timeUsedSeconds": 7,
            }
        write({"method": "turn/completed", "params": completed_params})
        break
