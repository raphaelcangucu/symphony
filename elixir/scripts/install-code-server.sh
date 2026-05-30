#!/usr/bin/env bash
set -euo pipefail

# Installs code-server (browser VS Code) as a standalone tarball under ~/.local.
# Used by Symphony's optional `editor:` WORKFLOW block. Idempotent: skips when
# the binary is already on PATH unless FORCE=1.

INSTALL_LIB_DIR="${CODE_SERVER_INSTALL_DIR:-${HOME}/.local/lib}"
BIN_DIR="${CODE_SERVER_BIN_DIR:-${HOME}/.local/bin}"
BINARY_NAME="code-server"
GITHUB_REPO="coder/code-server"
MAX_DOWNLOAD_ATTEMPTS="${CODE_SERVER_DOWNLOAD_ATTEMPTS:-5}"

if command -v "${BINARY_NAME}" >/dev/null 2>&1 && [[ "${FORCE:-}" != "1" ]]; then
  echo "✓ ${BINARY_NAME} already installed: $("${BINARY_NAME}" --version 2>&1 | head -1)"
  exit 0
fi

machine_arch="$(uname -m)"
case "${machine_arch}" in
  x86_64) arch_suffix="amd64" ;;
  aarch64 | arm64) arch_suffix="arm64" ;;
  *)
    echo "✗ Unsupported architecture: ${machine_arch}" >&2
    exit 1
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "✗ curl is required to download code-server" >&2
  exit 1
fi

echo "▶ Fetching latest ${GITHUB_REPO} release…"
version="$(
  curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
    | sed -n 's/.*"tag_name": "v\([^"]*\)".*/\1/p' \
    | head -1
)"

if [[ -z "${version}" ]]; then
  echo "✗ Could not determine latest code-server version from GitHub" >&2
  exit 1
fi

tarball_name="code-server-${version}-linux-${arch_suffix}.tar.gz"
download_url="https://github.com/${GITHUB_REPO}/releases/download/v${version}/${tarball_name}"
tmp_tar="$(mktemp "/tmp/${tarball_name}.XXXXXX")"

cleanup() {
  rm -f "${tmp_tar}"
}
trap cleanup EXIT

echo "▶ Downloading ${tarball_name}…"
attempt=1
while [[ "${attempt}" -le "${MAX_DOWNLOAD_ATTEMPTS}" ]]; do
  if curl -fSL "${download_url}" -o "${tmp_tar}"; then
    break
  fi

  if [[ "${attempt}" -eq "${MAX_DOWNLOAD_ATTEMPTS}" ]]; then
    echo "✗ Failed to download code-server after ${MAX_DOWNLOAD_ATTEMPTS} attempts" >&2
    echo "  URL: ${download_url}" >&2
    exit 1
  fi

  echo "… retry ${attempt}/${MAX_DOWNLOAD_ATTEMPTS}"
  attempt=$((attempt + 1))
  sleep 3
done

install_dir="${INSTALL_LIB_DIR}/code-server-${version}"
mkdir -p "${INSTALL_LIB_DIR}" "${BIN_DIR}"
rm -rf "${install_dir}"

echo "▶ Installing to ${install_dir}…"
tar -C "${INSTALL_LIB_DIR}" -xzf "${tmp_tar}"
mv "${INSTALL_LIB_DIR}/code-server-${version}-linux-${arch_suffix}" "${install_dir}"
ln -sf "${install_dir}/bin/${BINARY_NAME}" "${BIN_DIR}/${BINARY_NAME}"

if ! command -v "${BINARY_NAME}" >/dev/null 2>&1; then
  echo "✓ Installed ${BINARY_NAME} at ${BIN_DIR}/${BINARY_NAME}"
  echo "  Add ${BIN_DIR} to your PATH if it is not already."
fi

echo "✓ ${BINARY_NAME} installed: $("${BIN_DIR}/${BINARY_NAME}" --version 2>&1 | head -1)"
echo "  Enable in WORKFLOW.md with editor.enabled: true (see README)."
echo "  Run make configure-code-server to install Codex/Claude extensions."
