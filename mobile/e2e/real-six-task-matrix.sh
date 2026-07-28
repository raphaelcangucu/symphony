#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_PACKAGE="dev.dev10x.symphony"
readonly APP_ACTIVITY="${APP_PACKAGE}/.MainActivity"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_DIR="$(cd "${MOBILE_DIR}/.." && pwd)"
readonly ELIXIR_DIR="${REPO_DIR}/elixir"
readonly APK_PATH="${1:-${MOBILE_DIR}/android/app/build/outputs/apk/release/app-release.apk}"
readonly OUTPUT_DIR="${E2E_OUTPUT_DIR:-${MOBILE_DIR}/artifacts/e2e/six-task-real}"
readonly HOST_PORT="${DEV10X_SIX_TASK_PORT:-4110}"
readonly HOST_NAME="Dev10x Local Studio"
readonly PROJECT_SLUG="dev10x-six-task-e2e"
readonly ADMIN_TOKEN="mobile-six-task-e2e-admin"
readonly APP_VIDEO_PATH="${OUTPUT_DIR}/dev10x-six-task-real-app-e2e.mp4"
readonly CREATION_VIDEO_PATH="${OUTPUT_DIR}/creation.webm"
readonly EVIDENCE_VIDEO_PATH="${OUTPUT_DIR}/evidence.webm"
readonly TASKS_PATH="${OUTPUT_DIR}/tasks.tsv"
readonly REPORT_PATH="${OUTPUT_DIR}/six-task-report.json"
readonly TRACE_PATH="${OUTPUT_DIR}/trace.txt"
readonly SERVER_LOG_PATH="${OUTPUT_DIR}/symphony-server.log"
readonly UI_DUMP_PATH="${OUTPUT_DIR}/window.xml"
readonly REMOTE_UI_DUMP="/data/local/tmp/dev10x-six-task-window.xml"
readonly E2E_ROOT="${DEV10X_SIX_TASK_RESUME_ROOT:-$(mktemp -d)}"
readonly RESUME_E2E="${DEV10X_SIX_TASK_RESUME:-0}"
readonly TASK_TIMEOUT_ATTEMPTS="${DEV10X_SIX_TASK_TIMEOUT_ATTEMPTS:-360}"
readonly STALL_TIMEOUT_MS="${DEV10X_SIX_TASK_STALL_TIMEOUT_MS:-2400000}"

resolve_adb() {
  if [[ -n "${ADB_BIN:-}" ]]; then
    printf "%s" "${ADB_BIN}"
    return
  fi
  local sdk
  sdk="$(
    sed -n 's/^sdk\.dir=//p' "${MOBILE_DIR}/android/local.properties" 2>/dev/null |
      tail -n 1
  )"
  if [[ -n "${sdk}" && -x "${sdk}/platform-tools/adb" ]]; then
    printf "%s" "${sdk}/platform-tools/adb"
    return
  fi
  command -v adb
}

readonly ADB="$(resolve_adb)"
host_pid=""
recording=""
screen_width=""
screen_height=""
run_succeeded=0

trace_step() {
  printf "%s %s\n" "$(date --iso-8601=seconds)" "$*" >>"${TRACE_PATH}"
}

api_get() {
  local path="$1"
  curl --fail --silent \
    -H "authorization: Bearer ${ADMIN_TOKEN}" \
    "http://127.0.0.1:${HOST_PORT}/api/tracker/v1${path}"
}

api_post() {
  local path="$1"
  local body="${2:-}"
  [[ -n "${body}" ]] || body="{}"
  curl --fail --silent \
    -X POST \
    -H "authorization: Bearer ${ADMIN_TOKEN}" \
    -H "content-type: application/json" \
    --data "${body}" \
    "http://127.0.0.1:${HOST_PORT}/api/tracker/v1${path}"
}

dump_ui() {
  : >"${UI_DUMP_PATH}"
  "${ADB}" shell rm -f "${REMOTE_UI_DUMP}" >/dev/null 2>&1 || true
  timeout 15s "${ADB}" shell uiautomator dump "${REMOTE_UI_DUMP}" >/dev/null 2>&1 || true
  timeout 15s "${ADB}" exec-out cat "${REMOTE_UI_DUMP}" >"${UI_DUMP_PATH}" 2>/dev/null || true
}

wait_for_selector() {
  local attribute="$1"
  local value="$2"
  local attempts="${3:-60}"
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    grep -Fq "${attribute}=\"${value}\"" "${UI_DUMP_PATH}" && return 0
    sleep 1
  done
  printf "Selector not found: %s=%s\n" "${attribute}" "${value}" >&2
  return 1
}

wait_for_text() {
  wait_for_selector "text" "$1" "${2:-60}"
}

wait_for_ui_contains() {
  local value="$1"
  local attempts="${2:-60}"
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    grep -Fq "${value}" "${UI_DUMP_PATH}" && return 0
    sleep 1
  done
  printf "UI text fragment not found: %s\n" "${value}" >&2
  return 1
}

wait_for_enabled_accessible() {
  local value="$1"
  local attempts="${2:-60}"
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

configure_screen_geometry() {
  local size
  size="$(
    "${ADB}" shell wm size |
      tr -d '\r' |
      awk -F': ' '/Physical size|Override size/ {print $2}' |
      tail -n 1
  )"
  [[ "${size}" =~ ^([0-9]+)x([0-9]+)$ ]]
  screen_width="${BASH_REMATCH[1]}"
  screen_height="${BASH_REMATCH[2]}"
}

swipe_up() {
  "${ADB}" shell input swipe \
    "$((screen_width / 2))" "$((screen_height * 4 / 5))" \
    "$((screen_width / 2))" "$((screen_height * 3 / 10))" 450
  sleep 1
}

scroll_until_selector() {
  local attribute="$1"
  local value="$2"
  local attempts="${3:-24}"
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    grep -Fq "${attribute}=\"${value}\"" "${UI_DUMP_PATH}" && return 0
    swipe_up
  done
  printf "Selector not found while scrolling: %s=%s\n" "${attribute}" "${value}" >&2
  return 1
}

tap_scrolled_accessible() {
  local value="$1"
  scroll_until_selector "content-desc" "${value}"
  tap_selector "content-desc" "${value}"
}

input_text() {
  local value="${1// /%s}"
  "${ADB}" shell input text "${value}"
  trace_step "enter redacted text"
  sleep 1
}

deep_link() {
  local path="$1"
  "${ADB}" shell am start -W \
    -a android.intent.action.VIEW \
    -d "symphony:///${path#/}" \
    -n "${APP_ACTIVITY}" >/dev/null
  trace_step "open app route ${path}"
  sleep 1
}

start_recording() {
  local path="$1"
  rm -f "${path}"
  "${ADB}" emu screenrecord start "${path}" >"${E2E_ROOT}/screenrecord.log" 2>&1
  recording="active"
}

stop_recording() {
  if [[ -n "${recording}" ]]; then
    "${ADB}" emu screenrecord stop >/dev/null 2>&1 || true
    recording=""
    sleep 1
  fi
}

host_env() {
  env \
    SYMPHONY_LOCAL_TRACKER_DATABASE="${E2E_ROOT}/tracker.sqlite3" \
    SYMPHONY_TRACKER_HOST="0.0.0.0" \
    SYMPHONY_TRACKER_PORT="${HOST_PORT}" \
    SYMPHONY_TRACKER_TOKEN="${ADMIN_TOKEN}" \
    SYMPHONY_EDITOR_ENABLED="false" \
    SYMPHONY_OBSERVABILITY_ENABLED="false" \
    SYMPHONY_STALL_TIMEOUT_MS="${STALL_TIMEOUT_MS}" \
    SYMPHONY_SERVE_LOCK_PATH="${E2E_ROOT}/serve.lock" \
    "$@"
}

prepare_host() {
  local workspace="${E2E_ROOT}/workspace"
  (
    cd "${ELIXIR_DIR}"
    host_env mix ecto.create --quiet
    host_env mix ecto.migrate --quiet
    host_env mix run dev/mobile_six_task_e2e_seed.exs \
      "${HOST_NAME}" "${PROJECT_SLUG}" "${workspace}"
  ) >"${E2E_ROOT}/seed.log"
}

start_host() {
  (
    cd "${ELIXIR_DIR}"
    exec setsid env \
      SYMPHONY_LOCAL_TRACKER_DATABASE="${E2E_ROOT}/tracker.sqlite3" \
      SYMPHONY_TRACKER_HOST="0.0.0.0" \
      SYMPHONY_TRACKER_PORT="${HOST_PORT}" \
      SYMPHONY_TRACKER_TOKEN="${ADMIN_TOKEN}" \
      SYMPHONY_EDITOR_ENABLED="false" \
      SYMPHONY_OBSERVABILITY_ENABLED="false" \
      SYMPHONY_STALL_TIMEOUT_MS="${STALL_TIMEOUT_MS}" \
      SYMPHONY_SERVE_LOCK_PATH="${E2E_ROOT}/serve.lock" \
      mix run --no-halt
  ) >"${SERVER_LOG_PATH}" 2>&1 &
  host_pid="$!"
}

wait_for_host() {
  for _ in $(seq 1 90); do
    curl --fail --silent "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null && return 0
    sleep 1
  done
  printf "Symphony host did not become healthy\n" >&2
  return 1
}

create_offer() {
  api_post \
    "/mobile_rpc/pairing_offer" \
    "$(jq -cn \
      --arg endpoint "ws://10.0.2.2:${HOST_PORT}/mobile/rpc" \
      --arg host_name "${HOST_NAME}" \
      '{endpoint:$endpoint,host_name:$host_name,device_name:"Android six-task E2E"}')" |
    jq -er '.data.url'
}

catalog_model() {
  local catalog="$1"
  local agent="$2"
  local model="$3"
  jq -cer --arg agent "${agent}" --arg model "${model}" '
    .data.agents[]
    | select(.agent == $agent)
    | .models[]
    | select(.model == $model)
  ' <<<"${catalog}"
}

latest_issue_identifier() {
  local title="$1"
  api_get "/projects/${PROJECT_SLUG}/issues" |
    jq -er --arg title "${title}" '
      .data
      | map(select(.title == $title))
      | sort_by(.created_at)
      | last
      | .identifier
    '
}

wait_for_thread() {
  local scope="$1"
  local identifier="$2"
  local thread_id
  for _ in $(seq 1 120); do
    thread_id="$(
      api_get \
        "/assistant/threads?project_slug=${PROJECT_SLUG}&issue_identifier=${identifier}&limit=100" |
        jq -r --arg scope "${scope}" '
          .data
          | map(select(.scope == $scope))
          | sort_by(.id)
          | last
          | .id // empty
        '
    )"
    if [[ "${thread_id}" =~ ^[0-9]+$ ]]; then
      printf "%s" "${thread_id}"
      return 0
    fi
    sleep 1
  done
  printf "Thread not observed for %s (%s)\n" "${identifier}" "${scope}" >&2
  return 1
}

create_task() {
  local execution_path="$1"
  local agent_kind="$2"
  local agent_label="$3"
  local model_id="$4"
  local model_label="$5"
  local effort_label="$6"
  local title="$7"
  local description
  local identifier
  local thread_id

  description="Build a complete Dev10x branded site using the logos and colors in public Produce a real build focused tests screenshots video logs and a durable Symphony evidence manifest Work independently without subtasks"

  deep_link "/codex/tasks"
  wait_for_text "Tasks"
  tap_accessible "Create task"
  wait_for_text "New task"
  tap_accessible "Task title"
  input_text "${title}"
  tap_accessible "Task description"
  input_text "${description}"
  "${ADB}" shell input keyevent 4
  tap_scrolled_accessible "Select agent ${agent_label}"
  tap_scrolled_accessible "Select model ${model_label}"
  if [[ -n "${effort_label}" ]]; then
    tap_scrolled_accessible "Select effort ${effort_label}"
  fi
  tap_scrolled_accessible "Create task"
  wait_for_text "${title}" 90
  identifier="$(latest_issue_identifier "${title}")"
  trace_step "created independent task ${identifier} path=${execution_path} agent=${agent_kind}"

  if [[ "${execution_path}" == "session" ]]; then
    tap_scrolled_accessible "Open session"
    wait_for_text "New chat" 90
    wait_for_selector "content-desc" "Message" 90
    tap_accessible "Message"
    input_text "Execute this task fully now and save its durable evidence"
    wait_for_enabled_accessible "Send" 90
    "${ADB}" shell input keyevent 4
    tap_accessible "Send"
    wait_for_ui_contains "Execute this task fully now" 90
    thread_id="$(wait_for_thread "issue_session" "${identifier}")"
    trace_step "started direct rich session ${thread_id} for ${identifier}"
  else
    tap_scrolled_accessible "Continue agent"
    thread_id="$(wait_for_thread "issue_execution" "${identifier}")"
    trace_step "dispatched orchestrator execution ${thread_id} for ${identifier} from app"
  fi

  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
    "${execution_path}" "${agent_kind}" "${model_id}" "high" \
    "${identifier}" "${thread_id}" "${title}" >>"${TASKS_PATH}"
}

wait_for_manifest() {
  local identifier="$1"
  local thread_id="$2"
  local workspace
  for attempt in $(seq 1 "${TASK_TIMEOUT_ATTEMPTS}"); do
    workspace="$(
      api_get "/assistant/threads/${thread_id}" |
        jq -r '.data.workspace_path // empty'
    )"
    if [[ -n "${workspace}" && -s "${workspace}/.symphony/evidence/manifest.json" ]]; then
      if jq -e --arg issue "${identifier}" '
          (.issue == $issue) and
          (.runs | type == "array" and length > 0) and
          ([.runs[].status] | all(. == "passed")) and
          ([
            .runs[] as $run |
            (
              $run.artifacts[]?,
              $run.screenshots[]?,
              $run.videos[]?,
              $run.report?,
              $run.trace?
            )
            | select(type == "string" or type == "object")
          ] | length > 0)
        ' "${workspace}/.symphony/evidence/manifest.json" >/dev/null; then
        trace_step "durable manifest observed for ${identifier} thread=${thread_id}"
        return 0
      fi
    fi
    if ((attempt % 12 == 0)); then
      printf "Waiting for %s evidence (%s minutes)\n" "${identifier}" "$((attempt / 6))"
    fi
    sleep 10
  done
  printf "Durable manifest not produced for %s\n" "${identifier}" >&2
  return 1
}

capture_task_evidence() {
  local execution_path="$1"
  local agent_kind="$2"
  local identifier="$3"
  local title="$4"
  local artifact_label

  deep_link "/codex/issue/${PROJECT_SLUG}/${identifier}"
  wait_for_text "${title}" 90
  tap_scrolled_accessible "Open evidence"
  wait_for_text "${identifier} evidence" 90
  wait_for_ui_contains "Requested" 90
  wait_for_ui_contains "Resolved" 90
  "${ADB}" exec-out screencap -p \
    >"${OUTPUT_DIR}/${execution_path}-${agent_kind}-${identifier}-evidence.png"
  trace_step "capture task-scoped evidence ${identifier}"

  artifact_label="$(
    api_get "/projects/${PROJECT_SLUG}/issues/${identifier}/evidence" |
      jq -r '
        [
          .data[].manifest.runs[] as $run |
          ($run.artifacts[]?, $run.screenshots[]?, $run.videos[]?) |
          .label?
        ]
        | map(select(type == "string" and length > 0))
        | first // empty
      '
  )"
  if [[ -n "${artifact_label}" ]]; then
    if scroll_until_selector "content-desc" "Open ${artifact_label}" 16; then
      tap_selector "content-desc" "Open ${artifact_label}"
      sleep 2
      "${ADB}" exec-out screencap -p \
        >"${OUTPUT_DIR}/${execution_path}-${agent_kind}-${identifier}-artifact.png"
      trace_step "open native evidence artifact for ${identifier}"
    fi
  fi

  deep_link "/codex/issue/${PROJECT_SLUG}/${identifier}/evidence"
  wait_for_text "${identifier} evidence" 90
  if [[ "${execution_path}" == "session" ]]; then
    tap_scrolled_accessible "Open session log"
  else
    tap_scrolled_accessible "Open orchestrator log"
  fi
  wait_for_selector "content-desc" "Message" 90
  "${ADB}" exec-out screencap -p \
    >"${OUTPUT_DIR}/${execution_path}-${agent_kind}-${identifier}-log.png"
  trace_step "capture ${execution_path} log for ${identifier}"
}

capture_terminal() {
  local identifier="$1"
  local title="$2"
  deep_link "/codex/issue/${PROJECT_SLUG}/${identifier}"
  wait_for_text "${title}" 90
  tap_scrolled_accessible "Terminal"
  sleep 3
  "${ADB}" exec-out screencap -p >"${OUTPUT_DIR}/terminal.png"
  trace_step "capture task terminal over selected-host RPC"
}

build_report() {
  local records="${E2E_ROOT}/records.ndjson"
  : >"${records}"
  while IFS=$'\t' read -r execution_path agent_kind model_id effort identifier thread_id title; do
    local thread
    local issue
    local evidence
    local log_id
    thread="$(api_get "/assistant/threads/${thread_id}" | jq -c '.data')"
    issue="$(api_get "/projects/${PROJECT_SLUG}/issues/${identifier}" | jq -c '.data')"
    evidence="$(
      api_get "/projects/${PROJECT_SLUG}/issues/${identifier}/evidence" |
        jq -c '.data'
    )"
    log_id="${thread_id}"
    if [[ "${execution_path}" == "orchestrator" ]]; then
      log_id="$(
        api_get "/agent_executions" |
          jq -r --arg issue "${identifier}" '
            (
              if (.data | type) == "array" then .data
              else (.data.executions // [])
              end
            )
            | map(select(.issue_identifier == $issue))
            | sort_by(.execution_session_id)
            | last
            | .execution_session_id // empty
          '
      )"
      [[ -n "${log_id}" ]] || log_id="${thread_id}"
    fi
    jq -cn \
      --arg execution_path "${execution_path}" \
      --arg agent_kind "${agent_kind}" \
      --arg model_id "${model_id}" \
      --arg effort "${effort}" \
      --arg identifier "${identifier}" \
      --arg title "${title}" \
      --arg log_id "${log_id}" \
      --argjson thread "${thread}" \
      --argjson issue "${issue}" \
      --argjson evidence "${evidence}" \
      '{
        identifier:$identifier,
        title:$title,
        executionPath:$execution_path,
        agentKind:$agent_kind,
        requestedModel:($thread.requested_model // $model_id),
        requestedEffort:($thread.requested_effort // $effort),
        resolvedModel:($thread.resolved_model // $model_id),
        resolvedEffort:($thread.resolved_effort // $effort),
        status:($evidence[0].status // $issue.status),
        log:{kind:$execution_path,id:$log_id},
        evidence:[
          $evidence[].manifest.runs[] as $run |
          ($run.artifacts[]? | {kind:(.kind // "artifact"),path:.path}),
          ($run.screenshots[]? | {kind:"screenshot",path:.path}),
          ($run.videos[]? | {kind:"video",path:.path}),
          (
            if ($run.report? | type) == "string"
            then {kind:"report",path:$run.report}
            else empty
            end
          ),
          (
            if ($run.trace? | type) == "string"
            then {kind:"trace",path:$run.trace}
            else empty
            end
          )
        ]
      }' >>"${records}"
  done <"${TASKS_PATH}"

  jq -s \
    --arg project_slug "${PROJECT_SLUG}" \
    '{schemaVersion:1,projectSlug:$project_slug,tasks:.}' \
    "${records}" >"${REPORT_PATH}"
  node "${SCRIPT_DIR}/six-task-report.mjs" "${REPORT_PATH}"
}

encode_video() {
  local list_path="${E2E_ROOT}/videos.txt"
  printf "file '%s'\nfile '%s'\n" "${CREATION_VIDEO_PATH}" "${EVIDENCE_VIDEO_PATH}" >"${list_path}"
  ffmpeg -y -v error \
    -f concat -safe 0 -i "${list_path}" \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
    -shortest \
    -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 \
    -c:a aac -b:a 96k -movflags +faststart \
    "${APP_VIDEO_PATH}"
  ffprobe -v error \
    -show_entries format=duration:stream=codec_name,width,height \
    -of json "${APP_VIDEO_PATH}" >"${OUTPUT_DIR}/video-probe.json"
}

capture_failure() {
  trace_step "FAIL real six-task app journey"
  dump_ui
  "${ADB}" exec-out screencap -p >"${OUTPUT_DIR}/failure.png" 2>/dev/null || true
}

cleanup() {
  stop_recording
  if [[ "${run_succeeded}" == "1" ]]; then
    if [[ -n "${host_pid}" ]]; then
      kill -TERM -- "-${host_pid}" >/dev/null 2>&1 || true
      wait "${host_pid}" >/dev/null 2>&1 || true
    fi
    rm -rf "${E2E_ROOT}"
  else
    printf "Preserved failed E2E root: %s (host pid: %s)\n" "${E2E_ROOT}" "${host_pid}" >&2
  fi
  "${ADB}" shell rm -f "${REMOTE_UI_DUMP}" >/dev/null 2>&1 || true
}

trap capture_failure ERR
trap cleanup EXIT

if [[ ! -f "${APK_PATH}" ]]; then
  printf "APK not found: %s\n" "${APK_PATH}" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"
if [[ "${RESUME_E2E}" == "1" ]]; then
  [[ -s "${TASKS_PATH}" ]]
  host_pid="${DEV10X_SIX_TASK_HOST_PID:?resume requires DEV10X_SIX_TASK_HOST_PID}"
  wait_for_host
  "${ADB}" wait-for-device
  configure_screen_geometry
  "${ADB}" shell am force-stop "${APP_PACKAGE}"
  "${ADB}" shell monkey -p "${APP_PACKAGE}" -c android.intent.category.LAUNCHER 1 >/dev/null
  sleep 5
  deep_link "/codex/tasks"
  wait_for_text "Tasks"
  trace_step "resumed preserved six-task host, workspaces, sessions and orchestrator runs"
else
  : >"${TRACE_PATH}"
  : >"${TASKS_PATH}"
  prepare_host
  trace_step "prepared isolated real Symphony host database and workspace"
  start_host
  wait_for_host
  trace_step "real Symphony host is healthy"

  catalog="$(api_get "/projects/${PROJECT_SLUG}/assistant/config")"
  trace_step "loaded live assistant catalog"
  codex_model="$(catalog_model "${catalog}" "codex" "gpt-5.6-sol")"
  trace_step "resolved Codex GPT 5.6 Sol"
  claude_model="$(catalog_model "${catalog}" "claude" "claude-opus-5")"
  trace_step "resolved Claude Opus 5"
  cursor_model="$(catalog_model "${catalog}" "cursor" "cursor-grok-4.5-high")"
  trace_step "resolved Cursor Grok 4.5 High"
  codex_agent_label="$(
    jq -r '.data.agents[] | select(.agent == "codex") | .agent_label' <<<"${catalog}"
  )"
  claude_agent_label="$(
    jq -r '.data.agents[] | select(.agent == "claude") | .agent_label' <<<"${catalog}"
  )"
  cursor_agent_label="$(
    jq -r '.data.agents[] | select(.agent == "cursor") | .agent_label' <<<"${catalog}"
  )"
  codex_model_label="$(jq -r '.label' <<<"${codex_model}")"
  claude_model_label="$(jq -r '.label' <<<"${claude_model}")"
  cursor_model_label="$(jq -r '.label' <<<"${cursor_model}")"

  pairing_offer="$(create_offer)"
  trace_step "created redacted one-time pairing offer"
  "${ADB}" wait-for-device
  configure_screen_geometry
  "${ADB}" install --no-streaming -r "${APK_PATH}" >/dev/null
  "${ADB}" shell pm clear "${APP_PACKAGE}" >/dev/null
  "${ADB}" shell input keyevent 224
  "${ADB}" shell wm dismiss-keyguard
  "${ADB}" shell settings put global window_animation_scale 0
  "${ADB}" shell settings put global transition_animation_scale 0
  "${ADB}" shell settings put global animator_duration_scale 0

  start_recording "${CREATION_VIDEO_PATH}"
  "${ADB}" shell monkey -p "${APP_PACKAGE}" -c android.intent.category.LAUNCHER 1 >/dev/null
  sleep 3
  "${ADB}" shell am start -W \
    -a android.intent.action.VIEW \
    -d "${pairing_offer}" \
    -n "${APP_ACTIVITY}" >/dev/null
  wait_for_text "Pair with this Symphony host?"
  tap_accessible "Pair host"
  wait_for_text "${HOST_NAME}"
  trace_step "pair direct local Symphony host with per-device E2EE credential"

  create_task \
    "session" "codex" "${codex_agent_label}" "gpt-5.6-sol" "${codex_model_label}" "High" \
    "Session Codex GPT 5 6 High Dev10x site"
  create_task \
    "session" "claude" "${claude_agent_label}" "claude-opus-5" "${claude_model_label}" "High" \
    "Session Claude Opus 5 High Dev10x site"
  create_task \
    "session" "cursor" "${cursor_agent_label}" "cursor-grok-4.5-high" "${cursor_model_label}" "" \
    "Session Cursor Grok 4 5 High Dev10x site"
  create_task \
    "orchestrator" "codex" "${codex_agent_label}" "gpt-5.6-sol" "${codex_model_label}" "High" \
    "Orchestrator Codex GPT 5 6 High Dev10x site"
  create_task \
    "orchestrator" "claude" "${claude_agent_label}" "claude-opus-5" "${claude_model_label}" "High" \
    "Orchestrator Claude Opus 5 High Dev10x site"
  create_task \
    "orchestrator" "cursor" "${cursor_agent_label}" "cursor-grok-4.5-high" "${cursor_model_label}" "" \
    "Orchestrator Cursor Grok 4 5 High Dev10x site"

  deep_link "/codex/tasks"
  wait_for_text "Tasks"
  "${ADB}" exec-out screencap -p >"${OUTPUT_DIR}/six-independent-tasks.png"
  stop_recording
fi

while IFS=$'\t' read -r _path _agent _model _effort identifier thread_id _title; do
  wait_for_manifest "${identifier}" "${thread_id}"
done <"${TASKS_PATH}"

start_recording "${EVIDENCE_VIDEO_PATH}"
while IFS=$'\t' read -r execution_path agent_kind _model _effort identifier _thread_id title; do
  capture_task_evidence "${execution_path}" "${agent_kind}" "${identifier}" "${title}"
done <"${TASKS_PATH}"
first_identifier="$(awk -F '\t' '$1 == "session" {print $5; exit}' "${TASKS_PATH}")"
first_title="$(awk -F '\t' '$1 == "session" {print $7; exit}' "${TASKS_PATH}")"
capture_terminal "${first_identifier}" "${first_title}"
deep_link "/codex/tasks"
wait_for_text "Tasks"
stop_recording

build_report
encode_video
sha256sum "${APK_PATH}" "${APP_VIDEO_PATH}" >"${OUTPUT_DIR}/sha256.txt"
trace_step "PASS six independent real tasks with task-scoped app evidence"
run_succeeded=1
printf "Video: %s\nReport: %s\n" "${APP_VIDEO_PATH}" "${REPORT_PATH}"
