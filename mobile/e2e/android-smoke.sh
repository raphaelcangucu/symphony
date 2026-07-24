#!/usr/bin/env bash

set -euo pipefail

readonly APP_PACKAGE="dev.dev10x.symphony"
readonly APP_ACTIVITY="${APP_PACKAGE}/.MainActivity"
readonly EXPECTED_TEXT="Dev10x Mobile"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly APK_PATH="${1:-${MOBILE_DIR}/android/app/build/outputs/apk/release/app-release.apk}"
readonly OUTPUT_DIR="${E2E_OUTPUT_DIR:-${MOBILE_DIR}/artifacts/e2e}"
readonly VIDEO_PATH="${OUTPUT_DIR}/symphony-mobile-android-launch-smoke.mp4"
readonly SCREENSHOT_PATH="${OUTPUT_DIR}/symphony-mobile-android-launch-smoke.png"
readonly UI_DUMP_PATH="${OUTPUT_DIR}/symphony-mobile-android-launch-smoke.xml"
readonly REPORT_PATH="${OUTPUT_DIR}/symphony-mobile-android-launch-smoke.json"
readonly RECORDING_LOG_PATH="${OUTPUT_DIR}/symphony-mobile-android-launch-smoke-screenrecord.log"
readonly REMOTE_VIDEO="/sdcard/symphony-mobile-android-launch-smoke.mp4"
readonly RECORDING_SECONDS=12
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

stop_recording() {
  if [[ -n "${recording_pid}" ]]; then
    "${ADB}" shell pkill -INT screenrecord >/dev/null 2>&1 || true
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

"${ADB}" shell rm -f "${REMOTE_VIDEO}"
"${ADB}" shell screenrecord \
  --size "${RECORDING_SIZE}" \
  --bit-rate 6000000 \
  --time-limit "${RECORDING_SECONDS}" \
  --verbose \
  "${REMOTE_VIDEO}" >"${RECORDING_LOG_PATH}" 2>&1 &
recording_pid=$!

sleep 1
"${ADB}" shell am start -W -n "${APP_ACTIVITY}" >/dev/null

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
  "${ADB}" shell uiautomator dump /sdcard/symphony-mobile-window.xml >/dev/null 2>&1 || true
  "${ADB}" exec-out cat /sdcard/symphony-mobile-window.xml >"${UI_DUMP_PATH}" 2>/dev/null || true

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

sleep 3
"${ADB}" shell input keyevent HOME
sleep 1
"${ADB}" shell am start -W -n "${APP_ACTIVITY}" >/dev/null
sleep 1

foreground_activity="$(
  "${ADB}" shell dumpsys activity activities |
    tr -d '\r' |
    sed -n 's/.*\(topResumedActivity=\|mResumedActivity: \)ActivityRecord{[^ ]* [^ ]* \([^ ]*\).*/\2/p' |
    head -n 1
)"

if [[ "${foreground_activity}" != "${APP_ACTIVITY}" ]]; then
  printf "Expected foreground activity after relaunch %s, got %s\n" \
    "${APP_ACTIVITY}" "${foreground_activity}" >&2
  exit 1
fi

"${ADB}" exec-out screencap -p >"${SCREENSHOT_PATH}"
wait "${recording_pid}"
recording_pid=""
"${ADB}" pull "${REMOTE_VIDEO}" "${VIDEO_PATH}" >/dev/null

duration_seconds="$(
  ffprobe -v error \
    -show_entries format=duration \
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

if [[ ! "${screenshot_ymax}" =~ ^[0-9]+$ ]] || ((screenshot_ymax <= 20)); then
  printf "Captured screen is blank (YMAX=%s)\n" "${screenshot_ymax}" >&2
  exit 1
fi

apk_sha256="$(sha256sum "${APK_PATH}" | awk '{print $1}')"
video_sha256="$(sha256sum "${VIDEO_PATH}" | awk '{print $1}')"
generated_at="$(date --iso-8601=seconds)"

printf '{\n' >"${REPORT_PATH}"
printf '  "status": "passed",\n' >>"${REPORT_PATH}"
printf '  "test": "Android launch smoke shows the native app",\n' >>"${REPORT_PATH}"
printf '  "generated_at": "%s",\n' "${generated_at}" >>"${REPORT_PATH}"
printf '  "package": "%s",\n' "${APP_PACKAGE}" >>"${REPORT_PATH}"
printf '  "activity": "%s",\n' "${foreground_activity}" >>"${REPORT_PATH}"
printf '  "asserted_text": "%s",\n' "${EXPECTED_TEXT}" >>"${REPORT_PATH}"
printf '  "apk_sha256": "%s",\n' "${apk_sha256}" >>"${REPORT_PATH}"
printf '  "video_sha256": "%s",\n' "${video_sha256}" >>"${REPORT_PATH}"
printf '  "video_duration_seconds": %s,\n' "${duration_seconds}" >>"${REPORT_PATH}"
printf '  "video_frames": %s,\n' "${video_frames}" >>"${REPORT_PATH}"
printf '  "screenshot_ymax": %s,\n' "${screenshot_ymax}" >>"${REPORT_PATH}"
printf '  "video": "%s",\n' "${VIDEO_PATH}" >>"${REPORT_PATH}"
printf '  "screenshot": "%s"\n' "${SCREENSHOT_PATH}" >>"${REPORT_PATH}"
printf '}\n' >>"${REPORT_PATH}"

printf "PASS: Android launch smoke shows %s\n" "${EXPECTED_TEXT}"
printf "Video: %s\n" "${VIDEO_PATH}"
printf "Screenshot: %s\n" "${SCREENSHOT_PATH}"
printf "Report: %s\n" "${REPORT_PATH}"
