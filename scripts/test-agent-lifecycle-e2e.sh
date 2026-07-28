#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root/tracker"
npm run build
npx playwright test --config playwright.agent-lifecycle.config.ts
node ../scripts/write-agent-lifecycle-evidence.mjs
