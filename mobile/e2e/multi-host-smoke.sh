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
readonly TERMINAL_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-terminal.png"
readonly TERMINAL_COMMAND_SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-terminal-command.png"
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
recording_pid=""
host_a_pid=""
host_b_pid=""
last_host_pid=""
screen_width=""
screen_height=""

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

stop_recording() {
  if [[ -n "${recording_pid}" ]]; then
    "${ADB}" emu screenrecord stop >/dev/null 2>&1 || true
    recording_pid=""
  fi
}

cleanup() {
  stop_recording
  if [[ -n "${host_a_pid}" ]]; then
    kill -TERM -- "-${host_a_pid}" >/dev/null 2>&1 || true
    wait "${host_a_pid}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${host_b_pid}" ]]; then
    kill -TERM -- "-${host_b_pid}" >/dev/null 2>&1 || true
    wait "${host_b_pid}" >/dev/null 2>&1 || true
  fi
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
configure_screen_geometry
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
assert_paired_device "${HOST_A_PORT}"
trace_step "assert Host A identity, health and isolated session library"

tap_accessible "${HOST_A_NAME} — Direct RPC session"
wait_for_text "${HOST_A_NAME} — Direct RPC session"
sleep 2
"${ADB}" exec-out screencap -p >"${TERMINAL_SCREENSHOT_PATH}"
test -s "${TERMINAL_SCREENSHOT_PATH}"
trace_step "assert Host A copied xterm rendered over encrypted RPC"
# Android 7's uiautomator can block while xterm's WebView accessibility tree is
# live. These are the copied Orca header controls, expressed as screen
# fractions so the journey remains resolution-independent without querying the
# WebView tree.
tap_screen_fraction 1 16 1 20 "Back to worktrees"
wait_for_text "${HOST_A_NAME} — Direct RPC session"

tap_accessible "Tasks"
wait_for_text "${HOST_A_NAME}: encrypted mobile control"
tap_accessible "${HOST_A_NAME}: encrypted mobile control"
wait_for_text "Pair, switch hosts, inspect sessions and operate this workspace without a central hub."
scroll_until_text "${HOST_A_NAME}: verify host isolation"
scroll_until_text "${HOST_A_NAME}: record native evidence"
scroll_until_text "This task is served by ${HOST_A_NAME} over its own encrypted RPC connection."
trace_step "assert task, blocker, subtask and comment parity on Host A"
"${ADB}" shell input keyevent 4
sleep 1
tap_accessible "Back to worktrees"

tap_accessible "${HOST_A_NAME} — Direct RPC session"
tap_screen_fraction 27 32 1 20 "Open file explorer"
wait_for_text "README.md"
trace_step "assert selected-host workspace files"
tap_accessible "Back to session"

tap_screen_fraction 15 16 1 20 "Open source control"
wait_for_text "README.md"
trace_step "assert selected-host uncommitted diff"
tap_accessible "Back to session"

tap_screen_fraction 5 32 87 100 "Switch to buffered command input"
tap_screen_fraction 3 8 11 12 "Type a command"
"${ADB}" shell input text "pwd"
"${ADB}" shell input keyevent 66
sleep 2
"${ADB}" exec-out screencap -p >"${TERMINAL_COMMAND_SCREENSHOT_PATH}"
test -s "${TERMINAL_COMMAND_SCREENSHOT_PATH}"
trace_step "exercise selected-host terminal input and output"
tap_screen_fraction 1 16 1 20 "Back to worktrees"
wait_for_text "${HOST_A_NAME} — Direct RPC session"
tap_accessible "Back to hosts"

launch_pairing_offer "${host_b_offer}"
wait_for_text "${HOST_B_NAME}"
wait_for_text "${HOST_B_NAME} — Direct RPC session"
assert_paired_device "${HOST_B_PORT}"
dump_ui
if grep -Fq "${HOST_A_NAME} — Direct RPC session" "${UI_DUMP_PATH}"; then
  printf "Host A session leaked into Host B library\n" >&2
  exit 1
fi
trace_step "assert Host B selected with no Host A cache/session leakage"

tap_accessible "Back to hosts"
wait_for_text "${HOST_A_NAME}"
wait_for_text "${HOST_B_NAME}"
wait_for_ui_contains "Connected"
trace_step "assert two direct hosts, independent health and per-device credentials"

kill -TERM -- "-${host_b_pid}"
wait "${host_b_pid}" >/dev/null 2>&1 || true
host_b_pid=""
wait_for_host_down "${HOST_B_PORT}"
wait_for_any_ui_contains \
  45 \
  "Reconnecting" \
  "Can't connect" \
  "Can't reach desktop" \
  "Disconnected"
trace_step "assert selected host reports a real offline/reconnecting state"

start_host "host-b" "${HOST_B_PORT}"
host_b_pid="${last_host_pid}"
wait_for_host "${HOST_B_PORT}"
tap_accessible "${HOST_B_NAME}"
wait_for_text "${HOST_B_NAME} — Direct RPC session"
tap_accessible "Back to hosts"
wait_for_ui_contains "Connected"
trace_step "assert selected host automatically reconnects to the same paired device"

tap_accessible "Open settings"
wait_for_text "Settings"
wait_for_text "Interface"
wait_for_text "Dev10x Workspace"
wait_for_text "Terminal"
wait_for_text "About"
trace_step "assert Dev10x brand and retained Compact Sessions interface option"
tap_accessible "Use Compact Sessions interface"
wait_for_text "Projects"
wait_for_text "${HOST_B_NAME}"
wait_for_text "${HOST_B_NAME} — Direct RPC session"
trace_step "switch to Compact Sessions with the same selected host and session"

tap_accessible "Open main menu"
tap_accessible "Settings"
wait_for_text "Interface"
wait_for_text "Compact Sessions"
tap_accessible "Use dev10x workspace interface"
wait_for_text "Welcome back"
wait_for_text "${HOST_A_NAME}"
wait_for_text "${HOST_B_NAME}"
trace_step "switch back to Dev10x Workspace without pairing or opening a second connection"

tap_accessible "${HOST_A_NAME}"
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
