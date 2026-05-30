---
github:
  repo: clouapp/front
  project:
    mode: existing
    id: "PVT_kwDOCpPais4BY509"
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
    gh repo clone clouapp/front front -- --depth 1 -b homolog
    gh repo clone clouapp/back back -- --depth 1 -b dev
    cat > front/.env.local <<ENV
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
  completion_transitions:
    Todo: Human Review
    In Progress: Human Review
    Rework: Human Review
    Merging: Done
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

## Repositories

This is a **multi-repository** workspace. Issues and the Project board live on `clouapp/front`, but a single issue may require changes in either or both repos.

| Repo | Path | Integration branch | PR base |
|------|------|--------------------|---------|
| `clouapp/front` (frontend) | `front/` | `homolog` | `homolog` |
| `clouapp/back` (backend) | `back/` | `dev` | `dev` |

- Workspaces are cloned by `hooks.after_create` into `front/` and `back/`.
- Before handoff, sync each repo you touched with its integration branch:
  - frontend: `cd front && git fetch origin && git merge origin/homolog`
  - backend: `cd back && git fetch origin && git merge origin/dev`
- Open PRs **per repo against that repo's base**:
  - frontend: `cd front && gh pr create --base homolog --title "…"`
  - backend: `cd back && gh pr create --base dev --title "…"`
- On **Rework**, sync with the right integration branch per repo and address feedback. Do not target `master`/`main`.
- Backend conventions: prefer `sail`/`vibe` over bare `php`; follow `back/`'s own `AGENTS`/`.cursorrules` and PR template; commit messages in English.

## Agent routing (GitHub labels)

| Label | Agent |
|-------|--------|
| `symphony:codex` | Codex |
| `symphony:claude` | Claude |
| `symphony` | Default (**Codex** when this WORKFLOW includes `codex:`) |

Symphony only dispatches issues whose label resolves to an agent configured above.

Symphony reads and updates the GitHub Project **Status** field when moving cards. States align with the clouapp Linear board:

| State | Role |
|-------|------|
| Backlog | Out of scope; do not modify; wait for human to move to Todo |
| Todo | Queue; move to In Progress before work |
| In Progress | Active implementation |
| Human Review | PR ready; poll for human decision — **no further coding turns** |
| Rework | Address review feedback (see **Rework flow** below) |
| Merging | Follow `.codex/skills/land/SKILL.md` (PR base per repo: front → **`homolog`**, back → **`dev`**) |
| Done / Cancelled / Duplicate | Terminal |

Use a single `## Codex Workpad` comment for progress. Blockers: `Blocked by #N` or `Depends on clouapp/front#N`.

Raw GitHub GraphQL: `github_graphql` (same shape as `linear_graphql`).

## Rework flow (required)

When the Project **Status** is **Rework** (human moved the card after review):

1. **Read all feedback** before editing code:
   - Injected **Recent discussion** section in this prompt (issue comments + linked PR reviews/threads).
   - `gh issue view <number> --comments` for the full issue thread.
   - `gh pr view` and `gh pr view --comments` for the open PR tied to this work (if any).
   - Inline review threads on the PR (GitHub UI or `gh api` / `github_graphql`).
2. **Find or create** the `## Codex Workpad` comment. Summarize human feedback into **Acceptance criteria** and a short **Rework plan** (checkboxes) before implementation.
3. **Sync branch** (per repo you touched): front → `cd front && git fetch origin && git merge origin/homolog`; back → `cd back && git fetch origin && git merge origin/dev` (resolve conflicts, rerun checks).
4. Implement fixes; add/update **unit tests** per `AGENTS.md` and `.cursor/rules/testing-standards.mdc`.
5. Push and update the PR per repo (front base **`homolog`**, back base **`dev`**); run that repo's tests (front: `npm run test:unit` + lint; back: `./vibe test`); record results in the workpad **Validation** section.
6. Move to **Human Review** only when feedback is addressed and tests are green.

Do **not** ignore human comments that only appear on the PR — they are part of the rework scope.

## Tests and validation (mandatory)

Symphony does **not** run your test suite automatically. **You** must validate before **Human Review**, per `AGENTS.md` and [`.cursor/rules/testing-standards.mdc`](.cursor/rules/testing-standards.mdc):

- Treat ticket `Validation`, `Test Plan`, or `Testing` sections as required; mirror them in the workpad.
- **Frontend (`front/`)** — when you changed frontend code:
  - Run lint: `cd front && npm run lint`
  - Run unit tests: `cd front && npm run test:unit` (or targeted: `npm run test:unit -- tests/...`)
  - Add/update Vitest tests under `front/tests/` (mirror `front/src/`).
- **Backend (`back/`)** — when you changed backend code:
  - Run tests: `cd back && ./vibe test` (equivalently `vendor/bin/pest`).
  - Use `sail`/`vibe` for artisan/commands (not bare `php`).
  - Add/update Pest tests under `back/tests/`.
- Record in workpad **Validation**: `targeted tests: <command>` and outcome for each repo touched.
- Do **not** move to **Human Review** until, for every repo you changed:
  - Acceptance criteria are met
  - That repo's tests pass for the latest commit
  - A PR is open against that repo's base branch (front → `homolog`, back → `dev`), linked on the issue, checks green where applicable
- In **Human Review**, do not implement; wait and poll for human feedback.
