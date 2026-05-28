---
github:
  repo: clouapp/front
  project:
    mode: existing
    id: "PVT_kwDOCpPais4BY509"
  status_field: Symphony State
  native_status_field: Status
  sync_native_status: true
  comment_context_limit: 30
  # Base label; issues with symphony, symphony:codex, or symphony:claude are admitted.
  admission_label: symphony
# To dogfood the local tracker UI/API against this workflow instead of GitHub,
# remove the `github:` section and uncomment:
#
# local:
#   database_path: .symphony/tracker.sqlite3
#   project_slug: macro-markets
#   api_token_env: SYMPHONY_TRACKER_TOKEN
tracker:
  field_states:
    - Backlog
    - Todo
    - In Progress
    - Human Review
    - Rework
    - Merging
    - Done
    - Cancelled
    - Duplicate
  active_states:
    - Todo
    - In Progress
    - Rework
    - Merging
  wait_states:
    - Human Review
  terminal_states:
    - Done
    - Cancelled
    - Duplicate
polling:
  interval_ms: 5000
workspace:
  root: ~/code/macro-markets-workspaces
hooks:
  after_create: |
    git clone --depth 1 -b homolog https://github.com/clouapp/front .
    cat > .env.local <<ENV
    # Local ------------------------------------------------------------------------------------------- #
    # APP
    APP_ENV=dev
    NEXT_PUBLIC_DEFAULT_LANGUAGE=en
    NEXT_PUBLIC_ENABLE_PERSISTED_QUERIES=true

    # GRAPHQL
    NEXT_PUBLIC_API_URL=https://acp.macro.markets
    NEXT_PUBLIC_USE_API_PROXY=true

    # TURNSTILE
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
    NEXT_PRIVATE_TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA

    # MEILISEARCH
    NEXT_PUBLIC_MEILISEARCH_BASE_URL=http://localhost:9115
    NEXT_PUBLIC_MEILISEARCH_KEY=masterKey

    # LARAVEL REVERB
    NEXT_PUBLIC_PUSHER_APP_KEY=app-key
    NEXT_PUBLIC_PUSHER_CLUSTER=mt1
    NEXT_PUBLIC_PUSHER_WS_HOST=localhost
    NEXT_PUBLIC_PUSHER_WS_PORT=8080
    NEXT_PUBLIC_PUSHER_WSS_PORT=443
    NEXT_PUBLIC_PUSHER_FORCE_TLS=false
    NEXT_PUBLIC_REVERB_APP_ID=app-id
    NEXT_PUBLIC_REVERB_APP_SECRET=app-secret

    # TENOR
    NEXT_PUBLIC_TENOR_MEDIA_HOST=media.tenor.com

    NEXT_PUBLIC_GIT_BRANCH=homolog
    NEXT_PUBLIC_GIT_COMMIT=local
    NEXT_PUBLIC_GIT_TAG=none
    NEXT_PUBLIC_BUILD_TIME=local

    CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-85869ee1df284e998701dafe6e734c5d}
    CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN:-}
    ENV
agent:
  max_concurrent_agents: 5
  max_turns: 20
codex:
  command: codex --config shell_environment_policy.inherit=all app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
claude:
  command: symphony-claude
---

You are working on GitHub issue `{{ issue.identifier }}` in the **Macro Markets** board (`clouapp/front`).

Read and follow **`AGENTS.md`** in the workspace root (integration branch, PR base, lint, and unit tests).

Symphony injects **recent issue and PR comments** into your prompt when available. On **Rework**, those comments (and the workpad) define what you must do next.

## Integration branch (`homolog`)

- The repo integration branch is **`homolog`**, not `master` or `main`.
- Workspaces are cloned from `homolog` via `hooks.after_create`.
- Before handoff, merge latest integration: `git fetch origin && git merge origin/homolog`.
- Open PRs against **`homolog`**: `gh pr create --base homolog --title "…"`.
- On **Rework**, sync with `origin/homolog` and address review feedback; do not target `master` for PRs.

## Agent routing (GitHub labels)

| Label | Agent |
|-------|--------|
| `symphony:codex` | Codex |
| `symphony:claude` | Claude |
| `symphony` | Default (**Codex** when this WORKFLOW includes `codex:`) |

Symphony only dispatches issues whose label resolves to an agent configured above.

Symphony updates **both** `Symphony State` and the built-in GitHub **Status** field when moving cards (same option names). States align with the clouapp Linear board:

| State | Role |
|-------|------|
| Backlog | Out of scope; do not modify; wait for human to move to Todo |
| Todo | Queue; move to In Progress before work |
| In Progress | Active implementation |
| Human Review | PR ready; poll for human decision — **no further coding turns** |
| Rework | Address review feedback (see **Rework flow** below) |
| Merging | Follow `.codex/skills/land/SKILL.md` (merge target branch is **`homolog`**) |
| Done / Cancelled / Duplicate | Terminal |

Use a single `## Codex Workpad` comment for progress. Blockers: `Blocked by #N` or `Depends on clouapp/front#N`.

Raw GitHub GraphQL: `github_graphql` (same shape as `linear_graphql`).

## Rework flow (required)

When **Symphony State** is **Rework** (human moved the card after review):

1. **Read all feedback** before editing code:
   - Injected **Recent discussion** section in this prompt (issue comments + linked PR reviews/threads).
   - `gh issue view <number> --comments` for the full issue thread.
   - `gh pr view` and `gh pr view --comments` for the open PR tied to this work (if any).
   - Inline review threads on the PR (GitHub UI or `gh api` / `github_graphql`).
2. **Find or create** the `## Codex Workpad` comment. Summarize human feedback into **Acceptance criteria** and a short **Rework plan** (checkboxes) before implementation.
3. **Sync branch**: `git fetch origin && git merge origin/homolog` (resolve conflicts, rerun checks).
4. Implement fixes; add/update **unit tests** per `AGENTS.md` and `.cursor/rules/testing-standards.mdc`.
5. Push, update the PR (base **`homolog`**), run `npm run test:unit` and lint; record results in the workpad **Validation** section.
6. Move to **Human Review** only when feedback is addressed and tests are green.

Do **not** ignore human comments that only appear on the PR — they are part of the rework scope.

## Tests and validation (mandatory)

Symphony does **not** run your test suite automatically. **You** must validate before **Human Review**, per `AGENTS.md` and [`.cursor/rules/testing-standards.mdc`](.cursor/rules/testing-standards.mdc):

- Treat ticket `Validation`, `Test Plan`, or `Testing` sections as required; mirror them in the workpad.
- For every changed component, hook, or util: add or update Vitest tests under `tests/` (mirror `src/`).
- Run lint when touching TS/TSX: `npm run lint`.
- Run unit tests: `npm run test:unit` (or targeted: `npm run test:unit -- tests/...`).
- Record in workpad **Validation**: `targeted tests: <command>` and outcome.
- Do **not** move to **Human Review** until:
  - Acceptance criteria are met
  - `npm run test:unit` passes for the latest commit
  - PR is open against **`homolog`**, linked on the issue, and checks are green where applicable
- In **Human Review**, do not implement; wait and poll for human feedback.
