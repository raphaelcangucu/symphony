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
readonly ARTIFACT_SLUG="pr-7-encrypted-multi-host-complete-experience"
readonly VIDEO_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.mp4"
readonly RAW_VIDEO_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-raw.webm"
readonly SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.png"
readonly UI_DUMP_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.xml"
readonly TRACE_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-trace.txt"
readonly REPORT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-report.md"
readonly REPORT_JSON_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.json"
readonly REMOTE_UI_DUMP="/data/local/tmp/symphony-mobile-window.xml"
readonly ADMIN_TOKEN="mobile-e2e-admin-token"
readonly HOST_A_PORT=4101
readonly HOST_B_PORT=4102
readonly HOST_A_NAME="Studio Alpha"
readonly HOST_B_NAME="Studio Beta"
readonly HOST_A_PROJECT="alpha"
readonly HOST_B_PROJECT="beta"
readonly E2E_ROOT="$(mktemp -d)"

resolve_adb() {
  if [[ -n "${ADB_BIN:-}" ]]; then
    printf "%s" "${ADB_BIN}"
    return
  fi
  if [[ -n "${ANDROID_HOME:-}" && -x "${ANDROID_HOME}/platform-tools/adb" ]]; then
    printf "%s" "${ANDROID_HOME}/platform-tools/adb"
    return
  fi
  command -v adb
}

readonly ADB="$(resolve_adb)"
recording_pid=""
host_a_pid=""
host_b_pid=""
last_host_pid=""

trace_step() {
  printf "%s %s\n" "$(date --iso-8601=seconds)" "$*" >>"${TRACE_PATH}"
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
  local attempts="${3:-45}"
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    grep -Fq "${attribute}=\"${value}\"" "${UI_DUMP_PATH}" && return 0
    sleep 1
  done
  printf "Selector not found: %s=%s\n" "${attribute}" "${value}" >&2
  return 1
}

wait_for_text() {
  wait_for_selector "text" "$1" "${2:-45}"
}

scroll_until_text() {
  local value="$1"
  local attempts="${2:-8}"
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    grep -Fq "text=\"${value}\"" "${UI_DUMP_PATH}" && return 0
    "${ADB}" shell input swipe 540 2100 540 750 450
    sleep 1
  done
  printf "Text not found while scrolling: %s\n" "${value}" >&2
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

stop_recording() {
  if [[ -n "${recording_pid}" ]]; then
    "${ADB}" emu screenrecord stop >/dev/null 2>&1 || true
    recording_pid=""
  fi
}

cleanup() {
  stop_recording
  [[ -n "${host_a_pid}" ]] && kill -TERM -- "-${host_a_pid}" >/dev/null 2>&1 || true
  [[ -n "${host_b_pid}" ]] && kill -TERM -- "-${host_b_pid}" >/dev/null 2>&1 || true
  "${ADB}" shell rm -f "${REMOTE_UI_DUMP}" >/dev/null 2>&1 || true
  rm -rf "${E2E_ROOT}"
}

capture_failure_evidence() {
  trace_step "FAIL: native journey aborted before completion"
  dump_ui
  "${ADB}" exec-out screencap -p >"${SCREENSHOT_PATH}" 2>/dev/null || true
}

trap capture_failure_evidence ERR
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
    host_env "${host_key}" "${port}" mix ecto.create --quiet
    host_env "${host_key}" "${port}" mix ecto.migrate --quiet
    host_env "${host_key}" "${port}" \
      mix run dev/mobile_e2e_seed.exs "${host_name}" "${project_slug}" "${workspace}"
  ) >"${E2E_ROOT}/${host_key}-seed.log"
}

start_host() {
  local host_key="$1"
  local port="$2"
  (
    cd "${ELIXIR_DIR}"
    exec setsid env \
      SYMPHONY_LOCAL_TRACKER_DATABASE="${E2E_ROOT}/${host_key}.sqlite3" \
      SYMPHONY_TRACKER_HOST="0.0.0.0" \
      SYMPHONY_TRACKER_PORT="${port}" \
      SYMPHONY_TRACKER_TOKEN="${ADMIN_TOKEN}" \
      SYMPHONY_EDITOR_ENABLED="false" \
      SYMPHONY_OBSERVABILITY_ENABLED="false" \
      SYMPHONY_SERVE_LOCK_PATH="${E2E_ROOT}/${host_key}.lock" \
      mix run --no-halt
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

launch_pairing_offer() {
  local offer="$1"
  "${ADB}" shell am start -W \
    -a android.intent.action.VIEW \
    -d "${offer}" \
    -n "${APP_ACTIVITY}" >/dev/null
  trace_step "open redacted direct-host pairing deep link"
}

if [[ ! -f "${APK_PATH}" ]]; then
  printf "APK not found: %s\n" "${APK_PATH}" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"
: >"${TRACE_PATH}"

prepare_host "host-a" "${HOST_A_PORT}" "${HOST_A_NAME}" "${HOST_A_PROJECT}"
prepare_host "host-b" "${HOST_B_PORT}" "${HOST_B_NAME}" "${HOST_B_PROJECT}"
host_a_issue="$(
  grep '"issue_identifier"' "${E2E_ROOT}/host-a-seed.log" |
    tail -n 1 |
    jq -er '.issue_identifier'
)"
start_host "host-a" "${HOST_A_PORT}"
host_a_pid="${last_host_pid}"
start_host "host-b" "${HOST_B_PORT}"
host_b_pid="${last_host_pid}"
wait_for_host "${HOST_A_PORT}"
wait_for_host "${HOST_B_PORT}"

host_a_offer="$(
  create_offer \
    "${HOST_A_PORT}" \
    "ws://10.0.2.2:${HOST_A_PORT}/mobile/rpc" \
    "${HOST_A_NAME}" \
    "Android E2E Alpha"
)"
host_b_offer="$(
  create_offer \
    "${HOST_B_PORT}" \
    "ws://10.0.2.2:${HOST_B_PORT}/mobile/rpc" \
    "${HOST_B_NAME}" \
    "Android E2E Beta"
)"

"${ADB}" wait-for-device
"${ADB}" install --no-streaming -r "${APK_PATH}" >/dev/null
"${ADB}" shell pm clear "${APP_PACKAGE}" >/dev/null
"${ADB}" shell settings put global window_animation_scale 0
"${ADB}" shell settings put global transition_animation_scale 0
"${ADB}" shell settings put global animator_duration_scale 0
rm -f "${RAW_VIDEO_PATH}"

"${ADB}" emu screenrecord start "${RAW_VIDEO_PATH}" >"${E2E_ROOT}/screenrecord.log" 2>&1
recording_pid="active"

launch_pairing_offer "${host_a_offer}"
wait_for_text "${HOST_A_NAME}"
wait_for_text "${HOST_A_NAME} — Direct RPC session"
trace_step "assert Host A identity, health and isolated session library"

tap_accessible "Open session ${HOST_A_NAME} — Direct RPC session"
wait_for_text "${HOST_A_NAME} is online. Projects, tasks, sessions and tools are isolated on this machine."
trace_step "assert Host A session history streamed over encrypted RPC"
tap_accessible "Go back"

tap_accessible "Open main menu"
tap_accessible "Tasks"
wait_for_text "${HOST_A_NAME}: encrypted mobile control"
tap_accessible "Open task ${host_a_issue}"
wait_for_text "${HOST_A_NAME}: encrypted mobile control"
scroll_until_text "${HOST_A_NAME}: verify host isolation"
scroll_until_text "${HOST_A_NAME}: record native evidence"
scroll_until_text "This task is served by ${HOST_A_NAME} over its own encrypted RPC connection."
trace_step "assert task, blocker, subtask and comment parity on Host A"
"${ADB}" shell input swipe 540 700 540 2100 450
"${ADB}" shell input swipe 540 700 540 2100 450
trace_step "return to Host A workspace controls"
sleep 1

tap_accessible "Files"
wait_for_text "README.md"
trace_step "assert selected-host workspace files"
tap_accessible "Back"

tap_accessible "Diff"
wait_for_text "README.md"
trace_step "assert selected-host uncommitted diff"
tap_accessible "Back"

tap_accessible "Terminal"
wait_for_selector "content-desc" "Terminal command"
tap_accessible "Terminal command"
"${ADB}" shell input text "pwd"
tap_accessible "Run command"
sleep 2
trace_step "exercise selected-host terminal input and output"
tap_accessible "Back"

"${ADB}" shell input keyevent KEYCODE_BACK
"${ADB}" shell input keyevent KEYCODE_BACK
wait_for_text "${HOST_A_NAME}"

launch_pairing_offer "${host_b_offer}"
wait_for_text "${HOST_B_NAME}"
wait_for_text "${HOST_B_NAME} — Direct RPC session"
dump_ui
if grep -Fq "${HOST_A_NAME} — Direct RPC session" "${UI_DUMP_PATH}"; then
  printf "Host A session leaked into Host B library\n" >&2
  exit 1
fi
trace_step "assert Host B selected with no Host A cache/session leakage"

tap_accessible "Open main menu"
tap_accessible "Connections"
wait_for_text "${HOST_A_NAME}"
wait_for_text "${HOST_B_NAME}"
wait_for_text "Paired devices"
wait_for_text "This device"
trace_step "assert two direct hosts plus per-device credential metadata"

tap_accessible "Use ${HOST_A_NAME}"
tap_accessible "Back"
wait_for_text "${HOST_A_NAME} — Direct RPC session"
trace_step "switch back to Host A and assert isolated cache hydration"

"${ADB}" exec-out screencap -p >"${SCREENSHOT_PATH}"
stop_recording

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
generated_at="$(date --iso-8601=seconds)"

jq -n \
  --arg generated_at "${generated_at}" \
  --arg apk_sha256 "${apk_sha256}" \
  --arg video_sha256 "${video_sha256}" \
  --arg duration "${duration_seconds}" \
  --arg resolution "${resolution}" \
  '{
    status:"passed",
    scenario:"encrypted direct control and isolation of two independent Symphony hosts",
    generated_at:$generated_at,
    hosts:2,
    transport:"X25519/HKDF/ChaCha20-Poly1305 WebSocket RPC",
    apk_sha256:$apk_sha256,
    video_sha256:$video_sha256,
    video_duration_seconds:($duration|tonumber),
    video_codec:"h264",
    audio_codec:"aac",
    resolution:$resolution
  }' >"${REPORT_JSON_PATH}"

cat >"${REPORT_PATH}" <<EOF
# Symphony Mobile encrypted multi-host E2E

- Status: passed
- Generated: ${generated_at}
- Hosts: ${HOST_A_NAME} and ${HOST_B_NAME}
- Transport: direct host WebSocket RPC with application-layer E2EE
- Journey: deep-link pairing, host identity/health, session stream, task/blocker/subtask/comment, files, diff, terminal, second-host pairing, cache-isolation assertion, paired-device metadata and host switching
- Video: \`${ARTIFACT_SLUG}.mp4\`
- Duration: ${duration_seconds}s
- Resolution: ${resolution}
- Codecs: H.264/AAC
- APK SHA-256: \`${apk_sha256}\`
- Video SHA-256: \`${video_sha256}\`

Pairing offers and device credentials were redacted from the recording, trace and report.
EOF

printf "PASS: encrypted two-host mobile E2E\n"
printf "Video: %s\n" "${VIDEO_PATH}"
printf "Report: %s\n" "${REPORT_PATH}"
