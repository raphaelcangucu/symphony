#!/bin/sh
set -eu

agent="__AGENT__"
version="__VERSION__"
mode="__MODE__"

if [ "${1:-}" = "--version" ]; then
  if [ "$mode" = "probe_failure" ]; then
    exit 23
  fi
  echo "$agent fixture $version"
  exit 0
fi

if [ "${1:-}" = "auth-status" ]; then
  echo '{"authenticated":true}'
  exit 0
fi

if [ "${1:-}" = "usage" ]; then
  echo '{"plan":"fixture","session":20,"weekly":30,"credits":42}'
  exit 0
fi

if [ "${1:-}" = "hold" ]; then
  while [ ! -f "${SYMPHONY_FIXTURE_RELEASE_FILE:-/nonexistent}" ]; do
    sleep 0.1
  done
  exit 0
fi

echo '{"type":"fixture.completed"}'
