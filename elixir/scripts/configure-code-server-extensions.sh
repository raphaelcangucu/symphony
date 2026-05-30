#!/usr/bin/env bash
set -euo pipefail

# Configures the shared code-server user profile used by Symphony's browser editor:
# - Installs Codex (openai.chatgpt) and Claude Code (anthropic.claude-code)
# - Disables GitHub Copilot (built-in on code-server; cannot be uninstalled)
# - Keeps Copilot chat closed by default on startup

BINARY_NAME="${CODE_SERVER_BINARY:-code-server}"
USER_DATA_DIR="${CODE_SERVER_USER_DATA_DIR:-${HOME}/.local/share/code-server}"
SETTINGS_FILE="${USER_DATA_DIR}/User/settings.json"

CODEX_EXTENSION="openai.chatgpt"
CLAUDE_EXTENSION="anthropic.claude-code"
COPILOT_EXTENSIONS=("GitHub.copilot" "GitHub.copilot-chat")

if ! command -v "${BINARY_NAME}" >/dev/null 2>&1; then
  echo "✗ ${BINARY_NAME} not found — run make install-code-server first" >&2
  exit 1
fi

install_extension() {
  local extension_id="$1"

  if "${BINARY_NAME}" --list-extensions 2>/dev/null | grep -Fxq "${extension_id}"; then
    echo "✓ extension already installed: ${extension_id}"
    return 0
  fi

  echo "▶ Installing extension ${extension_id}…"
  "${BINARY_NAME}" --install-extension "${extension_id}"
}

remove_extension() {
  local extension_id="$1"

  if ! "${BINARY_NAME}" --list-extensions 2>/dev/null | grep -Fxq "${extension_id}"; then
    return 0
  fi

  echo "▶ Removing extension ${extension_id}…"
  if ! "${BINARY_NAME}" --uninstall-extension "${extension_id}" 2>/dev/null; then
    echo "… could not remove ${extension_id} (may be built-in)"
  fi
}

write_settings() {
  mkdir -p "$(dirname "${SETTINGS_FILE}")"

  if command -v python3 >/dev/null 2>&1; then
    SETTINGS_FILE="${SETTINGS_FILE}" python3 <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["SETTINGS_FILE"])
current = {}
if path.exists():
    try:
        current = json.loads(path.read_text())
    except json.JSONDecodeError:
        current = {}

desired = {
    "github.copilot.enable": {"*": False},
    "github.copilot.nextEditSuggestions.enabled": False,
    "github.copilot.chat.enabled": False,
    "chat.commandCenter.enabled": False,
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "workbench.startupEditor": "none",
    "workbench.sideBar.location": "left",
    "claudeCode.preferredLocation": "sidebar",
    "extensions.ignoreRecommendations": True,
}

current.update(desired)
path.write_text(json.dumps(current, indent=2) + "\n")
PY
  else
    cat >"${SETTINGS_FILE}" <<'JSON'
{
  "github.copilot.enable": {
    "*": false
  },
  "github.copilot.nextEditSuggestions.enabled": false,
  "github.copilot.chat.enabled": false,
  "chat.commandCenter.enabled": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "workbench.startupEditor": "none",
  "workbench.sideBar.location": "left",
  "claudeCode.preferredLocation": "sidebar",
  "extensions.ignoreRecommendations": true
}
JSON
  fi

  echo "✓ wrote ${SETTINGS_FILE}"
}

echo "▶ Configuring code-server extensions and settings…"

for extension_id in "${COPILOT_EXTENSIONS[@]}"; do
  remove_extension "${extension_id}"
done

install_extension "${CODEX_EXTENSION}"
install_extension "${CLAUDE_EXTENSION}"
write_settings

echo "✓ code-server configured:"
echo "  - Codex:   ${CODEX_EXTENSION}  (https://developers.openai.com/codex/ide)"
echo "  - Claude:  ${CLAUDE_EXTENSION}  (https://code.claude.com/docs/en/vs-code)"
echo "  - Copilot: disabled in settings (built-in chat panel stays closed by default)"
echo "  Reload any open code-server tabs (or restart Symphony) to apply."
