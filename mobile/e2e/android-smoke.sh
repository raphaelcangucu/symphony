#!/usr/bin/env bash

set -euo pipefail

readonly APP_PACKAGE="dev.dev10x.symphony"
readonly APP_ACTIVITY="${APP_PACKAGE}/.MainActivity"
readonly EXPECTED_TEXT="Connect to Symphony"
readonly E2E_DEEP_LINK="symphony:///connect?fixture=1"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly APK_PATH="${1:-${MOBILE_DIR}/android/app/build/outputs/apk/release/app-release.apk}"
readonly OUTPUT_DIR="${E2E_OUTPUT_DIR:-${MOBILE_DIR}/artifacts/e2e}"
readonly ARTIFACT_SLUG="pr-7-complete-mobile-app-experience"
readonly VIDEO_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.mp4"
readonly SCREENSHOT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.png"
readonly UI_DUMP_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.xml"
readonly TRACE_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-trace.txt"
readonly REPORT_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}.json"
readonly RECORDING_LOG_PATH="${OUTPUT_DIR}/${ARTIFACT_SLUG}-screenrecord.log"
readonly REMOTE_VIDEO="/sdcard/${ARTIFACT_SLUG}.mp4"
readonly RECORDING_SECONDS=150
readonly RECORDING_SIZE="576x1280"

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

trace_step() {
  printf "%s %s\n" "$(date --iso-8601=seconds)" "$*" >>"${TRACE_PATH}"
}

dump_ui() {
  "${ADB}" shell uiautomator dump /sdcard/symphony-mobile-window.xml >/dev/null 2>&1 || true
  "${ADB}" exec-out cat /sdcard/symphony-mobile-window.xml >"${UI_DUMP_PATH}" 2>/dev/null || true
}

wait_for_selector() {
  local attribute="$1"
  local value="$2"
  local attempts="${3:-30}"
  for _ in $(seq 1 "${attempts}"); do
    dump_ui
    grep -Fq "${attribute}=\"${value}\"" "${UI_DUMP_PATH}" && return 0
    sleep 1
  done
  printf "Selector not found: %s=%s\n" "${attribute}" "${value}" >&2
  return 1
}

tap_selector() {
  local attribute="$1"
  local value="$2"
  wait_for_selector "${attribute}" "${value}"
  local node
  local bounds
  node="$(
    sed 's/></>\n</g' "${UI_DUMP_PATH}" |
      grep -F "${attribute}=\"${value}\"" |
      head -n 1
  )"
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
}

tap_accessible_text() {
  local value="$1"
  dump_ui

  if grep -Fq "content-desc=\"${value}\"" "${UI_DUMP_PATH}"; then
    tap_selector "content-desc" "${value}"
  else
    tap_selector "text" "${value}"
  fi
}

hide_keyboard_if_visible() {
  local label="$1"
  "${ADB}" shell input keyevent KEYCODE_ESCAPE
  trace_step "dismiss ${label} keyboard"
  sleep 1
}

stop_recording() {
  if [[ -n "${recording_pid}" ]]; then
    "${ADB}" shell pkill -l 2 screenrecord >/dev/null 2>&1 || true
    wait "${recording_pid}" 2>/dev/null || true
    recording_pid=""
  fi
}

cleanup() {
  stop_recording
  "${ADB}" shell rm -f "${REMOTE_VIDEO}" >/dev/null 2>&1 || true
}

trap cleanup EXIT

if [[ ! -f "${APK_PATH}" ]]; then
  printf "APK not found: %s\n" "${APK_PATH}" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"
: >"${TRACE_PATH}"

"${ADB}" wait-for-device

boot_completed=""
for _ in $(seq 1 90); do
  boot_completed="$("${ADB}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
  [[ "${boot_completed}" == "1" ]] && break
  sleep 1
done

if [[ "${boot_completed}" != "1" ]]; then
  printf "Android device did not finish booting\n" >&2
  exit 1
fi

"${ADB}" install --no-streaming -r "${APK_PATH}" >/dev/null
"${ADB}" shell pm clear "${APP_PACKAGE}" >/dev/null
"${ADB}" shell am force-stop "${APP_PACKAGE}"
"${ADB}" shell input keyevent HOME
"${ADB}" shell settings put global window_animation_scale 0
"${ADB}" shell settings put global transition_animation_scale 0
"${ADB}" shell settings put global animator_duration_scale 0
sleep 2

"${ADB}" shell am start -W \
  -a android.intent.action.VIEW \
  -d "${E2E_DEEP_LINK}" \
  -n "${APP_ACTIVITY}" >/dev/null
trace_step "navigate ${E2E_DEEP_LINK}"

foreground_activity=""
for _ in $(seq 1 30); do
  foreground_activity="$(
    "${ADB}" shell dumpsys activity activities |
      tr -d '\r' |
      sed -n 's/.*\(topResumedActivity=\|mResumedActivity: \)ActivityRecord{[^ ]* [^ ]* \([^ ]*\).*/\2/p' |
      head -n 1
  )"
  [[ "${foreground_activity}" == "${APP_ACTIVITY}" ]] && break
  sleep 1
done

if [[ "${foreground_activity}" != "${APP_ACTIVITY}" ]]; then
  printf "Expected foreground activity %s, got %s\n" "${APP_ACTIVITY}" "${foreground_activity}" >&2
  exit 1
fi

ui_found="false"
for _ in $(seq 1 30); do
  dump_ui

  if grep -Fq "${EXPECTED_TEXT}" "${UI_DUMP_PATH}"; then
    ui_found="true"
    break
  fi

  sleep 1
done

if [[ "${ui_found}" != "true" ]]; then
  printf "Expected accessible text not found: %s\n" "${EXPECTED_TEXT}" >&2
  exit 1
fi

"${ADB}" shell rm -f "${REMOTE_VIDEO}"
"${ADB}" shell screenrecord \
  --size "${RECORDING_SIZE}" \
  --bit-rate 6000000 \
  --time-limit "${RECORDING_SECONDS}" \
  --verbose \
  "${REMOTE_VIDEO}" >"${RECORDING_LOG_PATH}" 2>&1 &
recording_pid=$!
sleep 1

tap_selector "content-desc" "Connection name"
"${ADB}" shell input text "Remote"
trace_step "input Connection name=Remote"

tap_selector "content-desc" "Tracker URL"
"${ADB}" shell input text "https\\://fixture.symphony.test"
trace_step "input Tracker URL=https://fixture.symphony.test"

tap_selector "content-desc" "Tracker token"
"${ADB}" shell input text "fixture-token"
trace_step "input Tracker token=[redacted]"
hide_keyboard_if_visible "connection"
tap_accessible_text "Connect"
wait_for_selector "text" "Projects"
wait_for_selector "text" "Implement mobile sessions"
trace_step "assert connection onboarding reached Projects"
sleep 2

tap_selector "text" "Implement mobile sessions"
wait_for_selector "text" "Session 42"
wait_for_selector "text" "Fixture session ready"
trace_step "assert existing session opened"
tap_selector "content-desc" "Go back"
wait_for_selector "text" "Projects"

tap_selector "content-desc" "Search chats"
"${ADB}" shell input text "mobile"
trace_step "input Search chats=mobile"
sleep 2
wait_for_selector "text" "Implement mobile sessions"
hide_keyboard_if_visible "search"

tap_selector "content-desc" "Start a new chat"
wait_for_selector "text" "New chat"
hide_keyboard_if_visible "new-session"

tap_selector "content-desc" "Choose project"
tap_selector "content-desc" "Use Symphony project"
wait_for_selector "text" "Symphony"

tap_selector "content-desc" "Issue identifier"
"${ADB}" shell input text "MOB-7"
trace_step "input Issue identifier=MOB-7"
hide_keyboard_if_visible "issue"

tap_selector "content-desc" "Choose workspace"
tap_selector "text" "New isolated workspace"
wait_for_selector "text" "New isolated workspace"

tap_selector "content-desc" "Message"
"${ADB}" shell input text "Build%sthe%smobile%ssession"
trace_step "input Message=Build the mobile session"
hide_keyboard_if_visible "composer"

tap_selector "content-desc" "Show advanced options"
tap_selector "content-desc" "Choose agent"
tap_selector "text" "Codex"
tap_selector "content-desc" "Choose model"
tap_selector "text" "GPT-5.6 Sol"
tap_selector "content-desc" "Choose effort"
tap_selector "text" "High"
trace_step "select Codex, GPT-5.6 Sol, High"

tap_selector "content-desc" "Send"

wait_for_selector "text" "Session 42"
wait_for_selector "text" "Build the mobile session"
wait_for_selector "text" "Fixture session ready"
trace_step "assert Session 42 with submitted seed"

tap_selector "content-desc" "Message"
"${ADB}" shell input text "Ship%sthe%smobile%sapp"
trace_step "input Message=Ship the mobile app"
hide_keyboard_if_visible "session"
tap_selector "content-desc" "Send"
wait_for_selector "text" "Ship the mobile app"
wait_for_selector "text" "Fixture response received"
trace_step "assert follow-up message and assistant response"
sleep 3

"${ADB}" exec-out screencap -p >"${SCREENSHOT_PATH}"
stop_recording
"${ADB}" pull "${REMOTE_VIDEO}" "${VIDEO_PATH}" >/dev/null

duration_seconds="$(
  ffprobe -v error \
    -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 \
    "${VIDEO_PATH}"
)"
video_codec="$(
  ffprobe -v error \
    -select_streams v:0 \
    -show_entries stream=codec_name \
    -of default=noprint_wrappers=1:nokey=1 \
    "${VIDEO_PATH}"
)"
video_frames="$(
  ffprobe -v error \
    -select_streams v:0 \
    -show_entries stream=nb_frames \
    -of default=noprint_wrappers=1:nokey=1 \
    "${VIDEO_PATH}"
)"
screenshot_ymax="$(
  ffmpeg -v error \
    -i "${SCREENSHOT_PATH}" \
    -vf "signalstats,metadata=print:file=-" \
    -frames:v 1 \
    -f null - 2>&1 |
    sed -n 's/.*lavfi.signalstats.YMAX=//p' |
    head -n 1
)"

if [[ ! "${duration_seconds}" =~ ^[0-9]+([.][0-9]+)?$ ]] ||
  ! awk -v duration="${duration_seconds}" 'BEGIN { exit !(duration >= 5) }'; then
  printf "Recorded video is too short: %ss\n" "${duration_seconds}" >&2
  exit 1
fi

if [[ ! "${video_frames}" =~ ^[0-9]+$ ]] || ((video_frames < 5)); then
  printf "Recorded video has too few frames: %s\n" "${video_frames}" >&2
  exit 1
fi

if [[ "${video_codec}" != "h264" ]]; then
  printf "Recorded video codec is not H.264: %s\n" "${video_codec}" >&2
  exit 1
fi

if [[ ! "${screenshot_ymax}" =~ ^[0-9]+$ ]] || ((screenshot_ymax <= 20)); then
  printf "Captured screen is blank (YMAX=%s)\n" "${screenshot_ymax}" >&2
  exit 1
fi

apk_sha256="$(sha256sum "${APK_PATH}" | awk '{print $1}')"
video_sha256="$(sha256sum "${VIDEO_PATH}" | awk '{print $1}')"
generated_at="$(date --iso-8601=seconds)"

printf '{\n' >"${REPORT_PATH}"
printf '  "status": "passed",\n' >>"${REPORT_PATH}"
printf '  "test": "Android E2E records the complete first-run connection, library, creation, and live session experience",\n' >>"${REPORT_PATH}"
printf '  "generated_at": "%s",\n' "${generated_at}" >>"${REPORT_PATH}"
printf '  "package": "%s",\n' "${APP_PACKAGE}" >>"${REPORT_PATH}"
printf '  "activity": "%s",\n' "${foreground_activity}" >>"${REPORT_PATH}"
printf '  "asserted_text": "%s",\n' "${EXPECTED_TEXT}" >>"${REPORT_PATH}"
printf '  "navigation": "%s",\n' "${E2E_DEEP_LINK}" >>"${REPORT_PATH}"
printf '  "apk_sha256": "%s",\n' "${apk_sha256}" >>"${REPORT_PATH}"
printf '  "video_sha256": "%s",\n' "${video_sha256}" >>"${REPORT_PATH}"
printf '  "video_duration_seconds": %s,\n' "${duration_seconds}" >>"${REPORT_PATH}"
printf '  "video_frames": %s,\n' "${video_frames}" >>"${REPORT_PATH}"
printf '  "video_codec": "%s",\n' "${video_codec}" >>"${REPORT_PATH}"
printf '  "screenshot_ymax": %s,\n' "${screenshot_ymax}" >>"${REPORT_PATH}"
printf '  "video": "%s",\n' "${VIDEO_PATH}" >>"${REPORT_PATH}"
printf '  "screenshot": "%s",\n' "${SCREENSHOT_PATH}" >>"${REPORT_PATH}"
printf '  "trace": "%s"\n' "${TRACE_PATH}" >>"${REPORT_PATH}"
printf '}\n' >>"${REPORT_PATH}"

printf "PASS: Android E2E recorded the complete real-route app experience from %s\n" "${EXPECTED_TEXT}"
printf "Video: %s\n" "${VIDEO_PATH}"
printf "Screenshot: %s\n" "${SCREENSHOT_PATH}"
printf "Trace: %s\n" "${TRACE_PATH}"
printf "Report: %s\n" "${REPORT_PATH}"
