#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_PACKAGE="dev.dev10x.symphony"
readonly APP_ACTIVITY="${APP_PACKAGE}/.MainActivity"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly APK_PATH="${1:-${MOBILE_DIR}/android/app/build/outputs/apk/release/app-release.apk}"
readonly OUTPUT_DIR="${E2E_OUTPUT_DIR:-${MOBILE_DIR}/artifacts/comparison/symphony}"
readonly ARTIFACT_SLUG="symphony-mobile-standalone-mock-e2e"
readonly VIDEO_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.mp4"
readonly RAW_VIDEO_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-raw.webm"
readonly SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.png"
readonly UI_DUMP_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.xml"
readonly TRACE_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-trace.txt"
readonly REPORT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.json"
readonly REMOTE_UI_DUMP="/data/local/tmp/symphony-mobile-mock-window.xml"
readonly MOCK_PORT=4103
readonly MOCK_HOST_NAME="Symphony Mock Host — NOT REAL"
readonly E2E_ROOT="$(mktemp -d)"
readonly PAIRING_FILE="${E2E_ROOT}/pairing-url"
readonly MOCK_LOG="${E2E_ROOT}/mock-server.log"

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
mock_pid=""

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

wait_for_mock_connections() {
  local expected="$1"
  for _ in $(seq 1 45); do
    local actual
    actual="$(grep -Fc "Client connected" "${MOCK_LOG}" 2>/dev/null || true)"
    [[ "${actual}" -ge "${expected}" ]] && return 0
    sleep 1
  done
  printf "Expected at least %s mock connections\n" "${expected}" >&2
  return 1
}

wait_for_mock_rpc() {
  local method="$1"
  for _ in $(seq 1 45); do
    grep -Fq "[mock] ${method} (id:" "${MOCK_LOG}" 2>/dev/null && return 0
    sleep 1
  done
  printf "Expected mock RPC call: %s\n" "${method}" >&2
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

stop_recording() {
  if [[ -n "${recording_pid}" ]]; then
    "${ADB}" emu screenrecord stop >/dev/null 2>&1 || true
    recording_pid=""
  fi
}

cleanup() {
  stop_recording
  if [[ -n "${mock_pid}" ]]; then
    kill -TERM -- "-${mock_pid}" >/dev/null 2>&1 || true
    wait "${mock_pid}" >/dev/null 2>&1 || true
  fi
  "${ADB}" reverse --remove "tcp:${MOCK_PORT}" >/dev/null 2>&1 || true
  "${ADB}" shell rm -f "${REMOTE_UI_DUMP}" >/dev/null 2>&1 || true
  rm -rf "${E2E_ROOT}"
}

capture_failure_evidence() {
  trace_step "FAIL: standalone mock journey aborted before completion"
  dump_ui
  "${ADB}" exec-out screencap -p >"${SCREENSHOT_PATH}" 2>/dev/null || true
}

trap capture_failure_evidence ERR
trap cleanup EXIT

if [[ ! -f "${APK_PATH}" ]]; then
  printf "APK not found: %s\n" "${APK_PATH}" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"
: >"${TRACE_PATH}"

(
  cd "${MOBILE_DIR}"
  exec setsid env \
    MOCK_PAIRING_FILE="${PAIRING_FILE}" \
    MOCK_DISCONNECT_AFTER_MS=3500 \
    MOCK_DISCONNECT_ONCE=1 \
    npm run mock-server
) >"${MOCK_LOG}" 2>&1 &
mock_pid="$!"

for _ in $(seq 1 30); do
  [[ -s "${PAIRING_FILE}" ]] && break
  sleep 1
done
if [[ ! -s "${PAIRING_FILE}" ]]; then
  printf "Mock pairing offer was not created\n" >&2
  sed -n "1,120p" "${MOCK_LOG}" >&2 || true
  exit 1
fi
if [[ "$(stat -c '%a' "${PAIRING_FILE}")" != "600" ]]; then
  printf "Mock pairing offer must be stored with mode 0600\n" >&2
  exit 1
fi
pairing_offer="$(<"${PAIRING_FILE}")"

"${ADB}" wait-for-device
"${ADB}" reverse "tcp:${MOCK_PORT}" "tcp:${MOCK_PORT}"
"${ADB}" install --no-streaming -r "${APK_PATH}" >/dev/null
"${ADB}" shell pm clear "${APP_PACKAGE}" >/dev/null
"${ADB}" shell settings put global window_animation_scale 0
"${ADB}" shell settings put global transition_animation_scale 0
"${ADB}" shell settings put global animator_duration_scale 0
rm -f "${RAW_VIDEO_PATH}"

"${ADB}" emu screenrecord start "${RAW_VIDEO_PATH}" >"${E2E_ROOT}/screenrecord.log" 2>&1
recording_pid="active"

"${ADB}" shell am start -W \
  -a android.intent.action.VIEW \
  -d "${pairing_offer}" \
  -n "${APP_ACTIVITY}" >/dev/null
trace_step "open redacted standalone-mock pairing deep link"

wait_for_text "Pair with this Symphony host?"
tap_accessible "Pair host"
trace_step "confirm explicit device-to-host pairing"

wait_for_text "${MOCK_HOST_NAME}"
wait_for_text "Dev10x mobile workspace"
trace_step "assert mock host identity and session library over production E2EE/RPC"

wait_for_mock_connections 2
wait_for_text "${MOCK_HOST_NAME}"
wait_for_text "Dev10x mobile workspace"
trace_step "assert automatic reconnect after one intentional mock disconnect"

tap_accessible "Dev10x mobile workspace"
wait_for_mock_rpc "terminal.subscribe"
sleep 2
assert_ui_absent "Terminal failed to load"
trace_step "assert copied xterm subscription and render over encrypted RPC"
tap_accessible "Back to worktrees"

tap_accessible "Tasks"
wait_for_text "Connect the copied Dev10x mobile experience"
tap_accessible "Connect the copied Dev10x mobile experience"
wait_for_text "Use the Symphony RPC host without changing the copied mobile interaction model."
trace_step "assert task detail from standalone mock"
"${ADB}" shell input keyevent 4
sleep 1
tap_accessible "Back to worktrees"

tap_accessible "Dev10x mobile workspace"
tap_accessible "Open file explorer"
wait_for_text "README.md"
trace_step "assert mock workspace file listing"
tap_accessible "Back to session"

tap_accessible "Open source control"
wait_for_ui_contains "mobile/src/app.tsx"
trace_step "assert mock Git diff"
tap_accessible "Back to session"

tap_accessible "Switch to buffered command input"
tap_accessible "Type a command…"
"${ADB}" shell input text "git%sstatus"
tap_accessible "Send command"
wait_for_mock_rpc "terminal.send"
trace_step "assert bidirectional terminal stream"
tap_accessible "Back to worktrees"

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
if ! awk -v duration="${duration_seconds}" 'BEGIN { exit !(duration >= 15) }'; then
  printf "Recorded video is too short: %ss\n" "${duration_seconds}" >&2
  exit 1
fi

jq -n \
  --arg generated_at "$(date --iso-8601=seconds)" \
  --arg apk_sha256 "$(sha256sum "${APK_PATH}" | awk '{print $1}')" \
  --arg video_sha256 "$(sha256sum "${VIDEO_PATH}" | awk '{print $1}')" \
  --arg duration "${duration_seconds}" \
  --arg resolution "${resolution}" \
  '{
    status:"passed",
    backend:"mock",
    evidence_boundary:"real app pairing/E2EE/RPC/streams; fake in-memory domain state",
    generated_at:$generated_at,
    reconnects_observed:1,
    apk_sha256:$apk_sha256,
    video_sha256:$video_sha256,
    video_duration_seconds:($duration|tonumber),
    video_codec:"h264",
    audio_codec:"aac",
    resolution:$resolution
  }' >"${REPORT_PATH}"

printf "PASS: Symphony standalone mock mobile E2E\n"
printf "Video: %s\n" "${VIDEO_PATH}"
printf "Report: %s\n" "${REPORT_PATH}"
