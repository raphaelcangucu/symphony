#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_PACKAGE="dev.dev10x.symphony"
readonly APP_ACTIVITY="${APP_PACKAGE}/.MainActivity"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_DIR="$(cd "${MOBILE_DIR}/.." && pwd)"
readonly ELIXIR_DIR="${REPO_DIR}/elixir"
readonly APK_PATH="${1:-${MOBILE_DIR}/android/app/build/outputs/apk/release/app-release.apk}"
readonly OUTPUT_DIR="${E2E_OUTPUT_DIR:-${MOBILE_DIR}/artifacts/e2e}"
readonly SINGLE_CELL_E2E="${DEV10X_SINGLE_CELL_E2E:-0}"
readonly TASK_ACTIONS_ONLY="${DEV10X_TASK_ACTIONS_E2E:-0}"
readonly ARTIFACT_SLUG="$(
  if [[ "${SINGLE_CELL_E2E}" == "1" ]]; then
    printf "pr-7-dev10x-single-cell-real-host-review"
  else
    printf "pr-7-dev10x-rich-chat-real-host-experience"
  fi
)"
readonly VIDEO_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.mp4"
readonly RAW_VIDEO_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-raw.webm"
readonly RAW_VIDEO_SEGMENT_PREFIX="${OUTPUT_DIR}/${ARTIFACT_SLUG}-raw-part"
readonly SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.png"
readonly CHAT_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-chat.png"
readonly ORCHESTRATOR_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-orchestrator.png"
readonly TERMINAL_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-terminal.png"
readonly TERMINAL_COMMAND_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-terminal-command.png"
readonly TASK_EVIDENCE_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-task-evidence.png"
readonly TASK_SESSION_SETTINGS_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-task-session-model-effort.png"
readonly TASK_SUMMARY_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-task-summary.png"
readonly TASK_PR_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-task-pr.png"
readonly TASK_MAGIC_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-task-magic.png"
readonly TASK_ACTIONS_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-task-actions.png"
readonly PROJECT_FLOW_SCREENSHOT_PATH="${OUTPUT_DIR}/project-flow.png"
readonly UI_DUMP_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.xml"
readonly TRACE_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-trace.txt"
readonly REPORT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-report.md"
readonly REPORT_JSON_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.json"
readonly REMOTE_UI_DUMP="/sdcard/symphony-mobile-window.xml"
readonly ADMIN_TOKEN="mobile-e2e-admin-token"
readonly HOST_A_PORT=4101
readonly HOST_B_PORT=4102
readonly HOST_A_NAME="Studio Alpha"
readonly HOST_B_NAME="Studio Beta"
readonly HOST_A_PROJECT="alpha"
readonly HOST_B_PROJECT="beta"
readonly REAL_AGENT_E2E="${DEV10X_E2E_REAL_AGENT:-1}"
readonly E2E_ROOT="$(mktemp -d)"

if [[ "${REAL_AGENT_E2E}" != "0" && "${REAL_AGENT_E2E}" != "1" ]]; then
  printf "DEV10X_E2E_REAL_AGENT must be 0 or 1\n" >&2
  exit 1
fi
if [[ "${SINGLE_CELL_E2E}" != "0" && "${SINGLE_CELL_E2E}" != "1" ]]; then
  printf "DEV10X_SINGLE_CELL_E2E must be 0 or 1\n" >&2
  exit 1
fi
if [[ "${TASK_ACTIONS_ONLY}" != "0" && "${TASK_ACTIONS_ONLY}" != "1" ]]; then
  printf "DEV10X_TASK_ACTIONS_E2E must be 0 or 1\n" >&2
  exit 1
fi

resolve_adb() {
  if [[ -n "${ADB_BIN:-}" ]]; then
    printf "%s" "${ADB_BIN}"
    return
  fi
  if [[ -n "${ANDROID_HOME:-}" && -x "${ANDROID_HOME}/platform-tools/adb" ]]; then
    printf "%s" "${ANDROID_HOME}/platform-tools/adb"
    return
  fi
  local local_sdk
  local_sdk="$(
    sed -n 's/^sdk\.dir=//p' "${MOBILE_DIR}/android/local.properties" 2>/dev/null |
      tail -n 1
  )"
  if [[ -n "${local_sdk}" && -x "${local_sdk}/platform-tools/adb" ]]; then
    printf "%s" "${local_sdk}/platform-tools/adb"
    return
  fi
  command -v adb
}

readonly ADB="$(resolve_adb)"
if command -v mise >/dev/null 2>&1; then
  readonly MIX_RUNNER="mise"
else
  readonly MIX_RUNNER="mix"
fi
recording_pid=""
host_a_pid=""
host_b_pid=""
last_host_pid=""
host_a_id=""
host_a_thread_id=""
orchestrator_session_id=""
seeded_execution_session_id=""
screen_width=""
screen_height=""
ui_dump_sequence=0

trace_step() {
  printf "%s %s\n" "$(date -Iseconds)" "$*" >>"${TRACE_PATH}"
}

dump_ui() {
  ui_dump_sequence="$((ui_dump_sequence + 1))"
  local remote_dump="${REMOTE_UI_DUMP}.${ui_dump_sequence}"
  : >"${UI_DUMP_PATH}"
  "${ADB}" shell rm -f "${remote_dump}" >/dev/null 2>&1 || true
  if "${ADB}" shell uiautomator dump "${remote_dump}" >/dev/null 2>&1; then
    "${ADB}" exec-out cat "${remote_dump}" >"${UI_DUMP_PATH}" 2>/dev/null || true
  fi
  "${ADB}" shell rm -f "${remote_dump}" >/dev/null 2>&1 || true
  sleep 0.2
}

wait_for_selector() {
  local attribute="$1"
  local value="$2"
  local attempts="${3:-45}"
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    grep -Fq "${attribute}=\"${value}\"" "${UI_DUMP_PATH}" && return 0
    sleep 1
  done
  printf "Selector not found: %s=%s\n" "${attribute}" "${value}" >&2
  return 1
}

assistant_message_contains() {
  local value="$1"
  python3 - "${UI_DUMP_PATH}" "${value}" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, expected = sys.argv[1:3]

try:
    root = ET.parse(path).getroot()
except (ET.ParseError, OSError):
    raise SystemExit(1)

nodes = list(root.iter("node"))
for index, node in enumerate(nodes):
    if node.attrib.get("resource-id") != "chat-message-assistant":
        continue
    for candidate in nodes[index + 1 :]:
        resource_id = candidate.attrib.get("resource-id", "")
        if resource_id in {"chat-message-assistant", "chat-message-user"}:
            break
        visible = " ".join(
            (
                candidate.attrib.get("text", ""),
                candidate.attrib.get("content-desc", ""),
            )
        )
        if expected in visible:
            raise SystemExit(0)

raise SystemExit(1)
PY
}

wait_for_assistant_text() {
  local value="$1"
  local attempts="${2:-45}"
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    assistant_message_contains "${value}" && return 0
    sleep 1
  done
  printf "Assistant response not found: %s\n" "${value}" >&2
  return 1
}

wait_for_enabled_accessible() {
  local value="$1"
  local attempts="${2:-45}"
  local node
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    node="$(
      sed 's/></>\n</g' "${UI_DUMP_PATH}" |
        grep -F "content-desc=\"${value}\"" |
        head -n 1
    )"
    if [[ "${node}" == *'enabled="true"'* ]]; then
      return 0
    fi
    sleep 1
  done
  printf "Accessible control not enabled: %s\n" "${value}" >&2
  return 1
}

wait_for_text() {
  wait_for_selector "text" "$1" "${2:-45}"
}

wait_for_ui_contains() {
  local value="$1"
  local attempts="${2:-45}"
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    grep -Fq "${value}" "${UI_DUMP_PATH}" && return 0
    sleep 1
  done
  printf "UI text fragment not found: %s\n" "${value}" >&2
  return 1
}

wait_for_any_ui_contains() {
  local attempts="$1"
  shift
  local values=("$@")
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    for value in "${values[@]}"; do
      grep -Fq "${value}" "${UI_DUMP_PATH}" && return 0
    done
    sleep 1
  done
  printf "None of the UI text fragments were found: %s\n" "${values[*]}" >&2
  return 1
}

assert_ui_absent() {
  local value="$1"
  dump_ui
  if grep -Fq "${value}" "${UI_DUMP_PATH}"; then
    printf "Unexpected UI text fragment: %s\n" "${value}" >&2
    return 1
  fi
}

assert_task_session_healthy() {
  wait_for_selector "content-desc" "Connection status: Completed" 45
  assert_ui_absent "RPC method failed"
  assert_ui_absent "Offline"
  trace_step "assert task execution remains connected without transient RPC errors"
}

configure_screen_geometry() {
  local size
  size="$(
    "${ADB}" shell wm size |
      tr -d '\r' |
      awk -F': ' '/Physical size|Override size/ {print $2}' |
      tail -n 1
  )"
  if [[ ! "${size}" =~ ^([0-9]+)x([0-9]+)$ ]]; then
    printf "Could not detect emulator screen geometry: %s\n" "${size}" >&2
    return 1
  fi
  screen_width="${BASH_REMATCH[1]}"
  screen_height="${BASH_REMATCH[2]}"
  trace_step "screen geometry ${screen_width}x${screen_height}"
}

swipe_up() {
  "${ADB}" shell input swipe \
    "$((screen_width / 2))" "$((screen_height * 4 / 5))" \
    "$((screen_width / 2))" "$((screen_height * 3 / 10))" \
    450
}

swipe_down() {
  "${ADB}" shell input swipe \
    "$((screen_width / 2))" "$((screen_height * 3 / 10))" \
    "$((screen_width / 2))" "$((screen_height * 4 / 5))" \
    450
}

scroll_until_selector() {
  local attribute="$1"
  local value="$2"
  local direction="${3:-up}"
  local attempts="${4:-8}"
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    grep -Fq "${attribute}=\"${value}\"" "${UI_DUMP_PATH}" && return 0
    if [[ "${direction}" == "down" ]]; then
      swipe_down
    else
      swipe_up
    fi
    sleep 1
  done
  printf "Selector not found while scrolling %s: %s=%s\n" \
    "${direction}" "${attribute}" "${value}" >&2
  return 1
}

scroll_until_text() {
  scroll_until_selector "text" "$1" "up" "${2:-8}"
}

tap_selector() {
  local attribute="$1"
  local value="$2"
  wait_for_selector "${attribute}" "${value}"
  local node
  local bounds
  node="$(sed 's/></>\n</g' "${UI_DUMP_PATH}" | grep -F "${attribute}=\"${value}\"" | head -n 1)"
  bounds="$(
    printf "%s" "${node}" |
      sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p'
  )"
  if [[ ! "${bounds}" =~ ^[0-9]+\ [0-9]+\ [0-9]+\ [0-9]+$ ]]; then
    printf "Could not resolve bounds for %s=%s\n" "${attribute}" "${value}" >&2
    return 1
  fi
  read -r x1 y1 x2 y2 <<<"${bounds}"
  "${ADB}" shell input tap "$(((x1 + x2) / 2))" "$(((y1 + y2) / 2))"
  trace_step "tap ${attribute}=${value}"
  sleep 1
}

tap_accessible() {
  local value="$1"
  dump_ui
  if grep -Fq "content-desc=\"${value}\"" "${UI_DUMP_PATH}"; then
    tap_selector "content-desc" "${value}"
  else
    tap_selector "text" "${value}"
  fi
}

input_text() {
  local value="$1"
  local character
  for ((index = 0; index < ${#value}; index++)); do
    character="${value:index:1}"
    if [[ "${character}" == " " ]]; then
      "${ADB}" shell input keyevent 62
    else
      "${ADB}" shell input text "${character}"
    fi
    sleep 0.08
  done
  trace_step "enter redacted text"
}

tap_screen_fraction() {
  local x_numerator="$1"
  local x_denominator="$2"
  local y_numerator="$3"
  local y_denominator="$4"
  local label="$5"
  local x="$((screen_width * x_numerator / x_denominator))"
  local y="$((screen_height * y_numerator / y_denominator))"
  "${ADB}" shell input tap "${x}" "${y}"
  trace_step "tap screen=${label}"
  sleep 1
}

tap_terminal_header_tool() {
  local tool="$1"

  # UI Automator can return an empty hierarchy while the xterm WebView owns the
  # active window. Keep these semantic targets centralized and separated by the
  # same responsive header proportions used by the native terminal layout.
  case "${tool}" in
    files)
      tap_screen_fraction 51 64 1 20 "Open file explorer"
      ;;
    source-control)
      tap_screen_fraction 59 64 1 20 "Open source control"
      ;;
    *)
      printf "Unknown terminal header tool: %s\n" "${tool}" >&2
      return 1
      ;;
  esac
}

start_recording() {
  rm -f "${RAW_VIDEO_PATH}" "${RAW_VIDEO_SEGMENT_PREFIX}-"*.webm
  "${ADB}" emu screenrecord start \
    "${RAW_VIDEO_SEGMENT_PREFIX}-000.webm" >"${E2E_ROOT}/screenrecord.log" 2>&1
  (
    local index=1
    while sleep 140; do
      "${ADB}" emu screenrecord stop >/dev/null 2>&1 || true
      "${ADB}" emu screenrecord start \
        "$(printf "%s-%03d.webm" "${RAW_VIDEO_SEGMENT_PREFIX}" "${index}")" \
        >>"${E2E_ROOT}/screenrecord.log" 2>&1
      index="$((index + 1))"
    done
  ) &
  recording_pid="$!"
}

stop_recording() {
  if [[ -n "${recording_pid}" ]]; then
    kill "${recording_pid}" >/dev/null 2>&1 || true
    wait "${recording_pid}" >/dev/null 2>&1 || true
    "${ADB}" emu screenrecord stop >/dev/null 2>&1 || true
    recording_pid=""
  fi
}

terminate_host() {
  local pid="$1"
  if ! kill -TERM -- "-${pid}" >/dev/null 2>&1; then
    kill -TERM "${pid}" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  stop_recording
  if [[ -n "${host_a_pid}" ]]; then
    terminate_host "${host_a_pid}"
    wait "${host_a_pid}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${host_b_pid}" ]]; then
    terminate_host "${host_b_pid}"
    wait "${host_b_pid}" >/dev/null 2>&1 || true
  fi
  "${ADB}" shell rm -f "${REMOTE_UI_DUMP}" >/dev/null 2>&1 || true
  rm -rf "${E2E_ROOT}"
}

capture_failure_evidence() {
  local exit_code="$1"
  local line_number="$2"
  local command="$3"
  trace_step "FAIL: exit=${exit_code} line=${line_number} command=${command}"
  printf "E2E failed: exit=%s line=%s command=%s\n" \
    "${exit_code}" "${line_number}" "${command}" >&2
  dump_ui
  "${ADB}" exec-out screencap -p >"${SCREENSHOT_PATH}" 2>/dev/null || true
  for diagnostic in host-a-seed.log host-a-server.log; do
    if [[ -f "${E2E_ROOT}/${diagnostic}" ]]; then
      cp "${E2E_ROOT}/${diagnostic}" "${OUTPUT_DIR}/${ARTIFACT_SLUG}-${diagnostic}"
    fi
  done
}

trap 'capture_failure_evidence "$?" "${LINENO}" "${BASH_COMMAND}"' ERR
trap cleanup EXIT

host_env() {
  local host_key="$1"
  local port="$2"
  shift 2
  env \
    SYMPHONY_LOCAL_TRACKER_DATABASE="${E2E_ROOT}/${host_key}.sqlite3" \
    SYMPHONY_TRACKER_HOST="0.0.0.0" \
    SYMPHONY_TRACKER_PORT="${port}" \
    SYMPHONY_TRACKER_TOKEN="${ADMIN_TOKEN}" \
    SYMPHONY_EDITOR_ENABLED="false" \
    SYMPHONY_OBSERVABILITY_ENABLED="false" \
    SYMPHONY_SERVE_LOCK_PATH="${E2E_ROOT}/${host_key}.lock" \
    DEV10X_SINGLE_CELL_E2E="${SINGLE_CELL_E2E}" \
    "$@"
}

prepare_host() {
  local host_key="$1"
  local port="$2"
  local host_name="$3"
  local project_slug="$4"
  local workspace="${E2E_ROOT}/${host_key}-workspace"

  (
    cd "${ELIXIR_DIR}"
    if [[ "${MIX_RUNNER}" == "mise" ]]; then
      host_env "${host_key}" "${port}" mise exec -- mix ecto.create --quiet
      host_env "${host_key}" "${port}" mise exec -- mix ecto.migrate --quiet
      host_env "${host_key}" "${port}" \
        mise exec -- mix run dev/mobile_e2e_seed.exs "${host_name}" "${project_slug}" "${workspace}"
    else
      host_env "${host_key}" "${port}" mix ecto.create --quiet
      host_env "${host_key}" "${port}" mix ecto.migrate --quiet
      host_env "${host_key}" "${port}" \
        mix run dev/mobile_e2e_seed.exs "${host_name}" "${project_slug}" "${workspace}"
    fi
  ) >"${E2E_ROOT}/${host_key}-seed.log"
}

start_host() {
  local host_key="$1"
  local port="$2"
  (
    cd "${ELIXIR_DIR}"
    host_command=(
      env
      "SYMPHONY_LOCAL_TRACKER_DATABASE=${E2E_ROOT}/${host_key}.sqlite3"
      "SYMPHONY_TRACKER_HOST=0.0.0.0"
      "SYMPHONY_TRACKER_PORT=${port}"
      "SYMPHONY_TRACKER_TOKEN=${ADMIN_TOKEN}"
      "SYMPHONY_EDITOR_ENABLED=false"
      "SYMPHONY_OBSERVABILITY_ENABLED=false"
      "SYMPHONY_SERVE_LOCK_PATH=${E2E_ROOT}/${host_key}.lock"
    )
    if [[ "${MIX_RUNNER}" == "mise" ]]; then
      host_command+=(mise exec -- mix run --no-halt)
    else
      host_command+=(mix run --no-halt)
    fi
    if command -v setsid >/dev/null 2>&1; then
      exec setsid "${host_command[@]}"
    else
      exec "${host_command[@]}"
    fi
  ) >"${E2E_ROOT}/${host_key}-server.log" 2>&1 &
  last_host_pid="$!"
}

wait_for_host() {
  local port="$1"
  for _ in $(seq 1 60); do
    curl --fail --silent "http://127.0.0.1:${port}/api/health" >/dev/null && return 0
    sleep 1
  done
  printf "Symphony host on port %s did not become healthy\n" "${port}" >&2
  return 1
}

wait_for_host_down() {
  local port="$1"
  for _ in $(seq 1 30); do
    if ! curl --fail --silent "http://127.0.0.1:${port}/api/health" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  printf "Symphony host on port %s did not stop\n" "${port}" >&2
  return 1
}

create_offer() {
  local port="$1"
  local endpoint="$2"
  local host_name="$3"
  local device_name="$4"
  curl --fail --silent \
    -H "authorization: Bearer ${ADMIN_TOKEN}" \
    -H "content-type: application/json" \
    --data "$(jq -cn \
      --arg endpoint "${endpoint}" \
      --arg host_name "${host_name}" \
      --arg device_name "${device_name}" \
      '{endpoint:$endpoint,host_name:$host_name,device_name:$device_name}')" \
    "http://127.0.0.1:${port}/api/tracker/v1/mobile_rpc/pairing_offer" |
    jq -er '.data.url'
}

assert_paired_device() {
  local port="$1"
  for _ in $(seq 1 30); do
    if curl --fail --silent \
      -H "authorization: Bearer ${ADMIN_TOKEN}" \
      "http://127.0.0.1:${port}/api/tracker/v1/mobile_rpc/devices" |
      jq -e '
        .data.devices | length == 1 and
        (.[0] | has("device_id")) and
        (.[0] | has("token_digest") | not)
      ' >/dev/null; then
      return 0
    fi
    sleep 1
  done
  printf "Expected one safely-listed paired device on port %s\n" "${port}" >&2
  return 1
}

dispatch_orchestrator_run() {
  local port="$1"
  local project_slug="$2"
  local issue_identifier="$3"
  curl --fail --silent \
    -X POST \
    -H "authorization: Bearer ${ADMIN_TOKEN}" \
    -H "content-type: application/json" \
    --data '{"action":"hard_reset","agent":"codex","mode":"yolo"}' \
    "http://127.0.0.1:${port}/api/tracker/v1/projects/${project_slug}/issues/${issue_identifier}/dispatch" \
    >/dev/null
  trace_step "dispatch real local orchestrator run ${issue_identifier}"
}

wait_for_orchestrator_run() {
  local port="$1"
  local issue_identifier="$2"
  local project_slug="$3"
  for _ in $(seq 1 120); do
    orchestrator_session_id="$(
      curl --fail --silent \
        -H "authorization: Bearer ${ADMIN_TOKEN}" \
        "http://127.0.0.1:${port}/api/tracker/v1/agent_executions" |
        jq -r --arg issue "${issue_identifier}" '
          (
            if (.data | type) == "array" then .data
            elif (.data | type) == "object" then (.data.executions // [])
            elif (.executions | type) == "array" then .executions
            else []
            end
          )
          | map(select(.issue_identifier == $issue and (.execution_session_id | type == "number")))
          | sort_by(.execution_session_id)
          | last
          | .execution_session_id // empty
        '
    )"
    if [[ ! "${orchestrator_session_id}" =~ ^[0-9]+$ ]]; then
      orchestrator_session_id="$(
        curl --fail --silent \
          -H "authorization: Bearer ${ADMIN_TOKEN}" \
          "http://127.0.0.1:${port}/api/tracker/v1/assistant/threads?project_slug=${project_slug}&limit=100" |
          jq -r --arg issue "${issue_identifier}" '
            (.data // [])
            | map(select(.scope == "issue_execution" and .issue_identifier == $issue and (.id | type == "number")))
            | sort_by(.id)
            | last
            | .id // empty
          '
      )"
    fi
    if [[ "${orchestrator_session_id}" =~ ^[0-9]+$ ]]; then
      trace_step "observe real execution session ${orchestrator_session_id}"
      return 0
    fi
    sleep 1
  done
  printf "Orchestrator run was not observed for %s\n" "${issue_identifier}" >&2
  return 1
}

launch_pairing_offer() {
  local offer="$1"
  "${ADB}" shell am start -W \
    -a android.intent.action.VIEW \
    -d "${offer}" \
    -n "${APP_ACTIVITY}" >/dev/null
  trace_step "open redacted direct-host pairing deep link"
  wait_for_text "Pair with this Symphony host?"
  tap_accessible "Pair host"
  trace_step "confirm explicit device-to-host pairing"
}

assert_canonical_project_flow() {
  wait_for_text "Projetos"
  wait_for_text "${HOST_A_NAME} Project"
  tap_accessible "Voltar"
  wait_for_text "MÁQUINAS"
  tap_accessible "Abrir máquina ${HOST_A_NAME}"
  wait_for_text "Projetos"
  tap_accessible "Abrir projeto ${HOST_A_NAME} Project"
  wait_for_text "WORKSPACES"
  wait_for_text "SESSÕES RECENTES"
  wait_for_text "TASKS"
  wait_for_selector "content-desc" "Criar"
  "${ADB}" exec-out screencap -p >"${PROJECT_FLOW_SCREENSHOT_PATH}"
  test -s "${PROJECT_FLOW_SCREENSHOT_PATH}"
  trace_step "assert canonical machine, project, workspace, session and task hierarchy"

  tap_accessible "Abrir workspace ${HOST_A_NAME} — Direct RPC session"
  wait_for_text "${HOST_A_NAME} — Direct RPC session"
  wait_for_selector "content-desc" "Message"
  tap_accessible "Go back"
  wait_for_text "WORKSPACES"
  trace_step "open a visible project workspace and return to its project"

  tap_accessible "Abrir sessão ${HOST_A_NAME} — Task execution"
  wait_for_ui_contains "#${seeded_execution_session_id}"
  wait_for_ui_contains "5.6 Sol Alto"
  tap_accessible "Go back"
  wait_for_text "SESSÕES RECENTES"
  trace_step "open a visible task execution with its persisted model and effort"

  tap_accessible "Abrir task ${host_a_issue}"
  wait_for_ui_contains "${HOST_A_NAME}: encrypted mobile control"
  tap_accessible "Back"
  wait_for_text "TASKS"
  trace_step "open a visible project task and return to its project"

  tap_accessible "Criar"
  wait_for_text "Criar no projeto"
  wait_for_text "Nova sessão"
  wait_for_text "Nova task"
  tap_accessible "Nova sessão"
  wait_for_text "O projeto já está selecionado."
  wait_for_text "Selecionar task"
  wait_for_ui_contains "Workspace"
  "${ADB}" shell input keyevent 4
  sleep 1
  trace_step "assert project-scoped new session and task actions"
}

launch_session_panel() {
  local route="symphony://h/${host_a_id}/chat/${host_a_thread_id}?name=Studio%20Alpha%20%E2%80%94%20Direct%20RPC%20session"
  "${ADB}" shell am start -W \
    -a android.intent.action.VIEW \
    -d "${route}" \
    -n "${APP_ACTIVITY}" >/dev/null
  trace_step "open selected-host workspace session panel"
}

launch_task_execution() {
  local route="symphony://h/${host_a_id}/run/${seeded_execution_session_id}?identifier=${host_a_issue}&projectSlug=${HOST_A_PROJECT}&agent=codex&status=completed"
  # adb joins shell arguments into a remote shell command, so unescaped query
  # separators would background `am start` and execute the remaining flags.
  route="${route//&/\\&}"
  "${ADB}" shell am start -W \
    -a android.intent.action.VIEW \
    -d "${route}" \
    -n "${APP_ACTIVITY}" >/dev/null
  trace_step "open seeded task-associated execution ${seeded_execution_session_id}"
}

assert_task_session_evidence() {
  launch_task_execution
  wait_for_ui_contains "#${seeded_execution_session_id}"
  wait_for_ui_contains "5.6 Sol Alto"
  "${ADB}" exec-out screencap -p >"${TASK_SESSION_SETTINGS_SCREENSHOT_PATH}"
  test -s "${TASK_SESSION_SETTINGS_SCREENSHOT_PATH}"
  trace_step "assert persisted model and effort survive execution restoration"
  assert_task_session_healthy
  wait_for_selector "content-desc" "Open ${host_a_issue} task"
  tap_accessible "Open ${host_a_issue} task"
  wait_for_ui_contains "${host_a_issue}"
  assert_ui_absent "Project not found"

  tap_accessible "Summary"
  wait_for_ui_contains "${HOST_A_NAME}: encrypted mobile control"
  wait_for_ui_contains "WORKPAD PROGRESS"
  wait_for_ui_contains "Open session"
  "${ADB}" exec-out screencap -p >"${TASK_SUMMARY_SCREENSHOT_PATH}"
  test -s "${TASK_SUMMARY_SCREENSHOT_PATH}"
  trace_step "assert associated task opens with focused Summary"

  tap_accessible "PR"
  wait_for_ui_contains "PR #418"
  wait_for_ui_contains "Passed"
  "${ADB}" exec-out screencap -p >"${TASK_PR_SCREENSHOT_PATH}"
  test -s "${TASK_PR_SCREENSHOT_PATH}"
  trace_step "assert PR tab exposes labeled semantic health"

  tap_accessible "Comments"
  wait_for_selector "content-desc" "New comment"
  tap_accessible "Evidence"
  wait_for_ui_contains "No evidence has been recorded."
  tap_accessible "Sessions"
  wait_for_selector "content-desc" "New task session"
  wait_for_ui_contains "Execution"
  trace_step "assert all five focused task tabs"

  tap_accessible "Back"
  wait_for_selector "content-desc" "Open composer actions"
  assert_task_session_healthy
  tap_accessible "Open composer actions"
  tap_accessible "Plan mode"
  trace_step "assert Plan mode is selected from the composer action sheet"

  tap_accessible "Open composer actions"
  tap_accessible "Magic"
  wait_for_ui_contains "E2E review"
  "${ADB}" exec-out screencap -p >"${TASK_MAGIC_SCREENSHOT_PATH}"
  test -s "${TASK_MAGIC_SCREENSHOT_PATH}"
  tap_accessible "Run E2E review"
  wait_for_selector "content-desc" "Open composer actions"
  assert_ui_absent "RPC method failed"
  assert_ui_absent "Offline"
  trace_step "assert a canonical Magic template runs from mobile"

  tap_accessible "Open composer actions"
  tap_accessible "Add context"
  tap_accessible "Search context"
  input_text "${host_a_issue}"
  wait_for_selector "content-desc" "Add issue ${host_a_issue}"
  tap_accessible "Add issue ${host_a_issue}"
  wait_for_selector "content-desc" "Remove issue ${host_a_issue}"
  "${ADB}" exec-out screencap -p >"${TASK_ACTIONS_SCREENSHOT_PATH}"
  test -s "${TASK_ACTIONS_SCREENSHOT_PATH}"
  tap_accessible "Remove issue ${host_a_issue}"
  trace_step "assert structured issue context is added and removed"
}

launch_source_control_panel() {
  local route="symphony://h/${host_a_id}/source-control/${host_a_thread_id}?name=Studio%20Alpha%20%E2%80%94%20Direct%20RPC%20session"
  "${ADB}" shell am force-stop "${APP_PACKAGE}"
  sleep 2
  "${ADB}" shell am start -W \
    -a android.intent.action.VIEW \
    -d "${route}" \
    -n "${APP_ACTIVITY}" >/dev/null
  trace_step "cold-start selected-host source control panel with persisted pairing"
}

launch_host_tasks_list() {
  local route="symphony://h/${host_a_id}/tasks"
  "${ADB}" shell am force-stop "${APP_PACKAGE}"
  sleep 2
  "${ADB}" shell am start -W \
    -a android.intent.action.VIEW \
    -d "${route}" \
    -n "${APP_ACTIVITY}" >/dev/null
  trace_step "cold-start selected-host task list with persisted pairing"
}

if [[ ! -f "${APK_PATH}" ]]; then
  printf "APK not found: %s\n" "${APK_PATH}" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"
: >"${TRACE_PATH}"

prepare_host "host-a" "${HOST_A_PORT}" "${HOST_A_NAME}" "${HOST_A_PROJECT}"
if [[ "${SINGLE_CELL_E2E}" == "0" ]]; then
  prepare_host "host-b" "${HOST_B_PORT}" "${HOST_B_NAME}" "${HOST_B_PROJECT}"
fi
host_a_issue="$(
  grep '"issue_identifier"' "${E2E_ROOT}/host-a-seed.log" |
    tail -n 1 |
    jq -er '.issue_identifier'
)"
host_a_orchestrator_issue="$(
  grep '"orchestrator_issue_identifier"' "${E2E_ROOT}/host-a-seed.log" |
    tail -n 1 |
    jq -er '.orchestrator_issue_identifier'
)"
host_a_thread_id="$(
  grep '"thread_id"' "${E2E_ROOT}/host-a-seed.log" |
    tail -n 1 |
    jq -er '.thread_id'
)"
seeded_execution_session_id="$(
  grep '"execution_session_id"' "${E2E_ROOT}/host-a-seed.log" |
    tail -n 1 |
    jq -er '.execution_session_id'
)"
start_host "host-a" "${HOST_A_PORT}"
host_a_pid="${last_host_pid}"
wait_for_host "${HOST_A_PORT}"
if [[ "${SINGLE_CELL_E2E}" == "0" ]]; then
  start_host "host-b" "${HOST_B_PORT}"
  host_b_pid="${last_host_pid}"
  wait_for_host "${HOST_B_PORT}"
fi

host_a_offer="$(
  create_offer \
    "${HOST_A_PORT}" \
    "ws://10.0.2.2:${HOST_A_PORT}/mobile/rpc" \
    "${HOST_A_NAME}" \
    "Android E2E Alpha"
)"
host_a_id="$(
  python3 - "${host_a_offer}" <<'PY'
import base64
import json
import sys
from urllib.parse import parse_qs, urlparse

code = parse_qs(urlparse(sys.argv[1]).query)["code"][0]
padding = "=" * (-len(code) % 4)
print(json.loads(base64.urlsafe_b64decode(code + padding))["host_id"])
PY
)"
if [[ "${SINGLE_CELL_E2E}" == "0" ]]; then
  host_b_offer="$(
    create_offer \
      "${HOST_B_PORT}" \
      "ws://10.0.2.2:${HOST_B_PORT}/mobile/rpc" \
      "${HOST_B_NAME}" \
      "Android E2E Beta"
  )"
fi

"${ADB}" wait-for-device
configure_screen_geometry
"${ADB}" install --no-streaming -r "${APK_PATH}" >/dev/null
"${ADB}" shell pm clear "${APP_PACKAGE}" >/dev/null
"${ADB}" shell input keyevent 224
"${ADB}" shell wm dismiss-keyguard
"${ADB}" shell settings put global window_animation_scale 0
"${ADB}" shell settings put global transition_animation_scale 0
"${ADB}" shell settings put global animator_duration_scale 0
start_recording

launch_pairing_offer "${host_a_offer}"
assert_paired_device "${HOST_A_PORT}"
trace_step "assert Host A accepted the paired Android device"
assert_canonical_project_flow
launch_session_panel
wait_for_text "${HOST_A_NAME} — Direct RPC session"
wait_for_ui_contains "${HOST_A_NAME} is online"
wait_for_selector "content-desc" "Message"
trace_step "assert rich chat opens by default with real persisted host history"

assert_task_session_evidence
if [[ "${TASK_ACTIONS_ONLY}" == "0" ]]; then
tap_accessible "Go back"
wait_for_text "${HOST_A_NAME} — Direct RPC session"
tap_accessible "${HOST_A_NAME} — Direct RPC session"
wait_for_ui_contains "${HOST_A_NAME} is online"

chat_history_anchor="${HOST_A_NAME} is online"
if [[ "${REAL_AGENT_E2E}" == "1" ]]; then
  tap_accessible "Message"
  input_text "Reply exactly VERIFIED42"
  wait_for_enabled_accessible "Send"
  tap_accessible "Send"
  wait_for_assistant_text "VERIFIED42" 180
  chat_history_anchor="VERIFIED42"
  "${ADB}" exec-out screencap -p >"${CHAT_SCREENSHOT_PATH}"
  test -s "${CHAT_SCREENSHOT_PATH}"
  trace_step "assert real local agent turn is visible in the unified chat"
else
  trace_step "skip provider-authenticated chat turn; credentialless CI validates persisted host history"
fi

tap_accessible "Go back"
wait_for_text "${HOST_A_NAME} — Direct RPC session"
tap_accessible "${HOST_A_NAME} — Direct RPC session"
wait_for_ui_contains "${chat_history_anchor}" 45
trace_step "assert chat history is restored after closing and reopening the session"

tap_accessible "Open terminal"
sleep 2
"${ADB}" exec-out screencap -p >"${TERMINAL_SCREENSHOT_PATH}"
test -s "${TERMINAL_SCREENSHOT_PATH}"
trace_step "assert terminal remains an explicit xterm tool over the same host RPC"

tap_screen_fraction 5 32 87 100 "Switch to buffered command input"
tap_screen_fraction 3 8 11 12 "Type a command"
input_text "pwd"
"${ADB}" shell input keyevent 66
sleep 2
"${ADB}" exec-out screencap -p >"${TERMINAL_COMMAND_SCREENSHOT_PATH}"
test -s "${TERMINAL_COMMAND_SCREENSHOT_PATH}"
trace_step "exercise selected-host terminal input and output"

tap_terminal_header_tool "files"
wait_for_text "README.md"
trace_step "assert selected-host workspace files"
tap_accessible "Back to session"

tap_terminal_header_tool "source-control"
wait_for_text "README.md"
trace_step "assert selected-host uncommitted diff"
launch_host_tasks_list
wait_for_text "${HOST_A_NAME}: encrypted mobile control"
tap_accessible "${HOST_A_NAME}: encrypted mobile control"
if [[ "${SINGLE_CELL_E2E}" == "1" ]]; then
  wait_for_ui_contains "Validate the complete Dev10x Mobile journey"
  assert_ui_absent "${HOST_A_NAME}: verify host isolation"
  assert_ui_absent "${HOST_A_NAME}: record native evidence"
else
  wait_for_text "Pair, switch hosts, inspect sessions and operate this workspace without a central hub."
  scroll_until_text "${HOST_A_NAME}: verify host isolation"
  scroll_until_text "${HOST_A_NAME}: record native evidence"
fi
scroll_until_text "This task is served by ${HOST_A_NAME} over its own encrypted RPC connection."
trace_step "assert standalone task detail and comment parity on Host A"
scroll_until_text "Open evidence"
tap_accessible "Open evidence"
wait_for_text "${host_a_issue} evidence"
"${ADB}" exec-out screencap -p >"${TASK_EVIDENCE_SCREENSHOT_PATH}"
test -s "${TASK_EVIDENCE_SCREENSHOT_PATH}"
trace_step "assert task evidence screen is available from the mobile task detail"
tap_accessible "Back"
wait_for_ui_contains "${host_a_issue}"
tap_accessible "Back to worktrees"
wait_for_text "${HOST_A_NAME} — Direct RPC session"

if [[ "${REAL_AGENT_E2E}" == "1" ]]; then
  dispatch_orchestrator_run \
    "${HOST_A_PORT}" \
    "${HOST_A_PROJECT}" \
    "${host_a_orchestrator_issue}"
  wait_for_orchestrator_run "${HOST_A_PORT}" "${host_a_orchestrator_issue}" "${HOST_A_PROJECT}"
  tap_accessible "Orchestrator runs"
  wait_for_text "Orchestrator runs"
  wait_for_text "${host_a_orchestrator_issue}"
  tap_accessible "Open ${host_a_orchestrator_issue} Codex execution"
  wait_for_ui_contains "#${orchestrator_session_id}"
  wait_for_selector "content-desc" "Message"
  wait_for_selector "content-desc" "Connection status: Live" 180
  trace_step "assert real orchestrator execution transcript opens in the same rich chat"

  tap_accessible "Message"
  input_text "Reply exactly ACK73"
  wait_for_enabled_accessible "Send"
  tap_accessible "Send"
  wait_for_assistant_text "ACK73" 180
  "${ADB}" exec-out screencap -p >"${ORCHESTRATOR_SCREENSHOT_PATH}"
  test -s "${ORCHESTRATOR_SCREENSHOT_PATH}"
  trace_step "assert mobile follow-up was accepted and streamed back from the real orchestrator"

  tap_accessible "Go back"
  wait_for_text "Orchestrator runs"
  tap_accessible "Go back"
  wait_for_text "${HOST_A_NAME} — Direct RPC session"
else
  trace_step "skip provider-authenticated orchestrator turn in credentialless CI"
fi
tap_accessible "Back to hosts"

if [[ "${SINGLE_CELL_E2E}" == "0" ]]; then
  launch_pairing_offer "${host_b_offer}"
  wait_for_text "${HOST_B_NAME}"
  wait_for_text "Projetos"
  wait_for_text "${HOST_B_NAME} Project"
  tap_accessible "Abrir workspaces"
  wait_for_text "${HOST_B_NAME} — Direct RPC session"
  assert_paired_device "${HOST_B_PORT}"
  dump_ui
  if grep -Fq "${HOST_A_NAME} — Direct RPC session" "${UI_DUMP_PATH}"; then
    printf "Host A session leaked into Host B library\n" >&2
    exit 1
  fi
  trace_step "assert Host B selected with no Host A cache/session leakage"

  tap_accessible "${HOST_B_NAME} — Direct RPC session"
  wait_for_ui_contains "${HOST_B_NAME} is online"
  wait_for_selector "content-desc" "Message"
  trace_step "assert Host B opens its own isolated chat history"
  tap_accessible "Go back"
  wait_for_text "${HOST_B_NAME} — Direct RPC session"
  tap_accessible "Back to hosts"
  wait_for_text "${HOST_A_NAME}"
  wait_for_text "${HOST_B_NAME}"
  wait_for_ui_contains "Connected"
  trace_step "assert two direct hosts, independent health and per-device credentials"

  terminate_host "${host_b_pid}"
  wait "${host_b_pid}" >/dev/null 2>&1 || true
  host_b_pid=""
  offline_port="${HOST_B_PORT}"
  offline_host_key="host-b"
else
  terminate_host "${host_a_pid}"
  wait "${host_a_pid}" >/dev/null 2>&1 || true
  host_a_pid=""
  offline_port="${HOST_A_PORT}"
  offline_host_key="host-a"
fi
wait_for_host_down "${offline_port}"
wait_for_any_ui_contains \
  45 \
  "Reconnecting" \
  "Can't connect" \
  "Can't reach desktop" \
  "Disconnected"
trace_step "assert selected host reports a real offline/reconnecting state"

start_host "${offline_host_key}" "${offline_port}"
if [[ "${SINGLE_CELL_E2E}" == "1" ]]; then
  host_a_pid="${last_host_pid}"
  reconnect_host="${HOST_A_NAME}"
else
  host_b_pid="${last_host_pid}"
  reconnect_host="${HOST_B_NAME}"
fi
wait_for_host "${offline_port}"
tap_accessible "${reconnect_host}"
wait_for_text "Projetos"
tap_accessible "Abrir workspaces"
wait_for_text "${reconnect_host} — Direct RPC session"
tap_accessible "Back to hosts"
wait_for_ui_contains "Connected"
trace_step "assert selected host automatically reconnects to the same paired device"

tap_accessible "Open settings"
wait_for_text "Settings"
wait_for_text "Terminal"
wait_for_text "Voice"
wait_for_text "Notifications"
wait_for_text "About"
trace_step "assert the single Dev10x interface and native device settings"
tap_accessible "Back"
wait_for_text "${HOST_A_NAME}"
if [[ "${SINGLE_CELL_E2E}" == "0" ]]; then
  wait_for_text "${HOST_B_NAME}"
fi

tap_accessible "${HOST_A_NAME}"
wait_for_text "Projetos"
tap_accessible "Abrir workspaces"
wait_for_text "${HOST_A_NAME} — Direct RPC session"
trace_step "switch back to Host A and assert isolated cache hydration"
fi

"${ADB}" exec-out screencap -p >"${SCREENSHOT_PATH}"
stop_recording

concat_manifest="${E2E_ROOT}/screenrecord-concat.txt"
: >"${concat_manifest}"
for segment in "${RAW_VIDEO_SEGMENT_PREFIX}-"*.webm; do
  test -s "${segment}"
  printf "file '%s'\n" "${segment}" >>"${concat_manifest}"
done
ffmpeg -y -v error \
  -f concat -safe 0 -i "${concat_manifest}" \
  -c copy \
  "${RAW_VIDEO_PATH}"

ffmpeg -y -v error \
  -i "${RAW_VIDEO_PATH}" \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
  -shortest \
  -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 \
  -c:a aac -b:a 96k \
  -movflags +faststart \
  "${VIDEO_PATH}"

duration_seconds="$(
  ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "${VIDEO_PATH}"
)"
video_codec="$(
  ffprobe -v error -select_streams v:0 -show_entries stream=codec_name \
    -of default=noprint_wrappers=1:nokey=1 "${VIDEO_PATH}"
)"
audio_codec="$(
  ffprobe -v error -select_streams a:0 -show_entries stream=codec_name \
    -of default=noprint_wrappers=1:nokey=1 "${VIDEO_PATH}"
)"
resolution="$(
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
    -of csv=s=x:p=0 "${VIDEO_PATH}"
)"

if [[ "${video_codec}" != "h264" || "${audio_codec}" != "aac" ]]; then
  printf "Unexpected codecs: video=%s audio=%s\n" "${video_codec}" "${audio_codec}" >&2
  exit 1
fi
if ! awk -v duration="${duration_seconds}" 'BEGIN { exit !(duration >= 20) }'; then
  printf "Recorded video is too short: %ss\n" "${duration_seconds}" >&2
  exit 1
fi

apk_sha256="$(sha256sum "${APK_PATH}" | awk '{print $1}')"
video_sha256="$(sha256sum "${VIDEO_PATH}" | awk '{print $1}')"
generated_at="$(date -Iseconds)"

if [[ "${TASK_ACTIONS_ONLY}" == "1" ]]; then
  scenario="Symphony canonical project flow, task detail and composer actions against a real host"
  interactive_chat="persisted task-associated execution over selected-host RPC"
  orchestrator_chat="not exercised by this focused journey"
  journey="deep-link pairing, Home/Machines, Projects, visible project Workspace/Task execution/Task navigation, project-scoped New session, associated task Summary/PR/Comments/Evidence/Sessions, Plan mode, Magic template, and structured issue context"
elif [[ "${REAL_AGENT_E2E}" == "1" ]]; then
  scenario="Dev10x rich chat, real session history and orchestrator follow-up against real Symphony host"
  interactive_chat="real local agent turn over selected-host RPC"
  orchestrator_chat="real execution transcript and follow-up over selected-host RPC"
  journey="deep-link pairing, host identity/health, chat-first real local agent turn, history restore, tools, terminal, standalone task/comment and evidence, files, diff, real orchestrator transcript and follow-up, offline recovery and settings"
else
  scenario="Dev10x credentialless CI contract against real Symphony host"
  interactive_chat="persisted selected-host history; provider-authenticated turn reserved for local E2E"
  orchestrator_chat="provider-authenticated run reserved for local E2E"
  journey="deep-link pairing, host identity/health, persisted chat history, tools, terminal, standalone task/comment, files, diff, offline recovery and settings"
fi

if [[ "${SINGLE_CELL_E2E}" == "1" ]]; then
  host_count=1
  host_report="${HOST_A_NAME}"
else
  host_count=2
  host_report="${HOST_A_NAME} and ${HOST_B_NAME}"
fi

jq -n \
  --arg generated_at "${generated_at}" \
  --arg apk_sha256 "${apk_sha256}" \
  --arg video_sha256 "${video_sha256}" \
  --arg duration "${duration_seconds}" \
  --arg resolution "${resolution}" \
  --arg scenario "${scenario}" \
  --arg interactive_chat "${interactive_chat}" \
  --arg orchestrator_chat "${orchestrator_chat}" \
  --argjson host_count "${host_count}" \
  --argjson single_cell "${SINGLE_CELL_E2E}" \
  --argjson task_actions_only "${TASK_ACTIONS_ONLY}" \
  --argjson real_agent "${REAL_AGENT_E2E}" \
  '{
    status:"passed",
    scenario:$scenario,
    generated_at:$generated_at,
    hosts:$host_count,
    single_cell:($single_cell == 1),
    task_actions_only:($task_actions_only == 1),
    real_agent_e2e:($real_agent == 1),
    interactive_chat:$interactive_chat,
    orchestrator_chat:$orchestrator_chat,
    transport:"X25519/HKDF/ChaCha20-Poly1305 WebSocket RPC",
    apk_sha256:$apk_sha256,
    video_sha256:$video_sha256,
    video_duration_seconds:($duration|tonumber),
    video_codec:"h264",
    audio_codec:"aac",
    resolution:$resolution
  }' >"${REPORT_JSON_PATH}"

cat >"${REPORT_PATH}" <<EOF
# Dev10x Mobile rich-chat real-host E2E

- Status: passed
- Generated: ${generated_at}
- Hosts: ${host_report}
- Single cell: ${SINGLE_CELL_E2E}
- Transport: direct host WebSocket RPC with application-layer E2EE
- Real local agent: ${REAL_AGENT_E2E}
- Journey: ${journey}
- Video: \`${ARTIFACT_SLUG}.mp4\`
- Duration: ${duration_seconds}s
- Resolution: ${resolution}
- Codecs: H.264/AAC
- APK SHA-256: \`${apk_sha256}\`
- Video SHA-256: \`${video_sha256}\`

Pairing offers and device credentials were redacted from the recording, trace and report.
EOF

printf "PASS: Dev10x rich-chat real-host mobile E2E\n"
printf "Video: %s\n" "${VIDEO_PATH}"
printf "Report: %s\n" "${REPORT_PATH}"
