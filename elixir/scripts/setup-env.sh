#!/usr/bin/env bash
set -euo pipefail

# Bootstrap elixir/.env with a fresh SYMPHONY_TRACKER_TOKEN and GITHUB_TOKEN from gh.
# Prerequisites: gh (authenticated), openssl.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
EXAMPLE_FILE="${ROOT_DIR}/.env.example"

die() {
  echo "✗ $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed."
}

upsert_env() {
  local key="$1"
  local value="$2"
  local file="$3"

  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

require_cmd gh
require_cmd openssl

if ! gh auth status >/dev/null 2>&1; then
  die "gh is not authenticated — run: gh auth login"
fi

github_token="$(gh auth token)" || die "failed to read GitHub token from gh"
[[ -n "${github_token}" ]] || die "gh auth token returned an empty value"

tracker_token="$(openssl rand -hex 24)"

if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${EXAMPLE_FILE}" ]]; then
    cp "${EXAMPLE_FILE}" "${ENV_FILE}"
    echo "▶ Created ${ENV_FILE} from .env.example"
  else
    touch "${ENV_FILE}"
    echo "▶ Created empty ${ENV_FILE}"
  fi
fi

upsert_env SYMPHONY_TRACKER_TOKEN "${tracker_token}" "${ENV_FILE}"
upsert_env GITHUB_TOKEN "${github_token}" "${ENV_FILE}"

echo "✓ ${ENV_FILE} updated"
echo "  SYMPHONY_TRACKER_TOKEN=<new $(echo -n "${tracker_token}" | wc -c) char secret>"
echo "  GITHUB_TOKEN=<from gh auth token>"
