# Macro Markets Multi-Repo Template — Design

## 1. Problem

`elixir/WORKFLOW.macromarkets.example.md` is a single-repo workflow: it clones only
`clouapp/front` (branch `homolog`) into the workspace root via `hooks.after_create` and
generates the Next.js `.env.local`. Real Macro Markets issues frequently touch the backend
(`clouapp/back`, a Laravel 12 / PHP 8.5 GraphQL service) as well. There is also no reusable
workspace template that captures this two-repo shape for the local-tracker wizard.

We want two deliverables:

1. A new builtin **workspace template** `priv/templates/macro-markets.yml` (same YAML shape as
   `multi-repo-fullstack.yml`) describing the front + back workspace.
2. An updated **`WORKFLOW.macromarkets.example.md`** that clones both repos into subdirectories
   and instructs the agent on per-repo branches, PR bases, and test commands — while keeping the
   GitHub tracker/board on `clouapp/front`.

## 2. Goal

- Capture the Macro Markets workspace as a reusable, importable template (front + back).
- Make the example workflow multi-repo without changing the tracker/board source.
- Document each repo's integration branch, PR base, and validation commands so agents open the
  right PRs and run the right tests per repo.

## 3. Non-goals

- No changes to Symphony Elixir source code (config schema, hooks runner, clone jobs). Both
  deliverables use existing, already-supported fields.
- No second tracker/board or second WORKFLOW file. Issues/Project stay on `clouapp/front`.
- No heavy bootstrap (Docker/Sail/`vibe`/`make install`) inside `after_create`. Repos are cloned
  only; environment bring-up is documented for on-demand use.
- No secret/`.env` material for the backend baked into the repo (the backend keeps encrypted env
  files; we do not reproduce them).

## 4. Decisions

| ID | Decision | Notes |
|----|---|---|
| D1 | Approach **A**: tracker stays on `clouapp/front`; the workspace becomes multi-repo with `front/` and `back/` subdirectories. | Minimal change; a single issue can touch both repos. |
| D2 | `workspace_path` = `front` and `back` (mirror repo names). | |
| D3 | Frontend integration branch / PR base = `homolog`. Backend integration branch / PR base = `dev`. | Backend CI (`workflow-controller.yml`) runs tests on PRs to `dev`, `production`, `macro`. `macro` is the Macro Markets deploy branch; `dev` is the integration base. We use `dev`. |
| D4 | `after_create` does **clone only** (no install). All environment setup is documented in `dev_env_markdown` (template) and the prompt body (WORKFLOW). | Per user choice; keeps per-issue workspace creation fast and headless-safe. |
| D5 | Frontend validation: `npm run lint`, `npm run test:unit`. Backend validation: `./vibe test` (≡ `./vendor/bin/sail pest`); CI equivalent is `vendor/bin/pest --parallel`. | From the front WORKFLOW and the backend `vibe`/CI inspection. |
| D6 | Backend agent conventions noted in the prompt: use `sail`/`vibe` (not bare `php`), PRs follow the backend's own `.github/pull_request_template.md`, base `dev`. | From `clouapp/back` `.cursorrules` + PR template. |
| D7 | Template `after_create_hook` is omitted (nil); the WORKFLOW `hooks.after_create` clones both repos and writes `front/.env.local`. | Template clones via CloneJob (repos list); WORKFLOW clones inline. |

## 5. Backend facts (from inspecting `clouapp/back@dev`)

- Laravel 12, PHP 8.5, Lighthouse GraphQL, Filament admin, Pest 4.
- Dev runner `vibe` (sail-like, git worktrees + shared Docker services) or `./vendor/bin/sail`.
  - `./vibe shared up` — start shared services (pgsql/redis/etc.).
  - `./vibe up` — start the app container.
  - `./vibe artisan migrate --seed` — migrate.
  - `./vibe test` → `./vendor/bin/sail pest`.
- Initial install: `make install` (composer install via Docker image + `php artisan sail:install` +
  image pull/build). Heavy; documentation-only.
- CI: PRs to `dev`/`production`/`macro` run `vendor/bin/pest --parallel --shard=...` after
  `composer install` and `php artisan migrate:fresh --seed`.
- `.cursorrules`: always use `sail` (not `php`); respond in Portuguese; commits in English.
- Own PR template at `.github/pull_request_template.md`.

## 6. Deliverable 1 — `elixir/priv/templates/macro-markets.yml`

YAML shape mirrors `multi-repo-fullstack.yml` / `single-repo-elixir.yml` and is decoded by
`SymphonyElixir.LocalTracker.TemplateYaml`. Recognized top-level keys: `slug`, `name`,
`description`, `validation_commands`, `workflow_statuses`, `after_create_hook`, `before_run_hook`,
`after_run_hook`, `before_remove_hook`, `prompt_template`, `dev_env_markdown`, `metadata`,
`repositories`.

```yaml
slug: macro-markets
name: Macro Markets
description: Macro Markets workspace — Next.js frontend (clouapp/front) + Laravel backend (clouapp/back).
validation_commands:
  - cd front && npm run lint
  - cd front && npm run test:unit
  - cd back && ./vibe test
workflow_statuses:
  - {name: Backlog,      category: backlog,  position: 0, is_terminal: false}
  - {name: Todo,         category: active,   position: 1, is_terminal: false}
  - {name: In Progress,  category: active,   position: 2, is_terminal: false}
  - {name: Human Review, category: wait,     position: 3, is_terminal: false}
  - {name: Rework,       category: active,   position: 4, is_terminal: false}
  - {name: Merging,      category: active,   position: 5, is_terminal: false}
  - {name: Done,         category: terminal, position: 6, is_terminal: true}
  - {name: Cancelled,    category: terminal, position: 7, is_terminal: true}
  - {name: Duplicate,    category: terminal, position: 8, is_terminal: true}
repositories:
  - github_full_name: clouapp/front
    clone_url: https://github.com/clouapp/front.git
    default_branch: homolog
    workspace_path: front
    role: frontend
  - github_full_name: clouapp/back
    clone_url: https://github.com/clouapp/back.git
    default_branch: dev
    workspace_path: back
    role: backend
prompt_template: |
  (multi-repo prompt — see §8)
dev_env_markdown: |
  (env setup — see §8)
metadata:
  source: builtin
```

Notes:
- `workflow_statuses` is used only when the template is applied to a **local** tracker; GitHub/Linear
  projects ignore it. Categories match `WorkflowSuggester` (`backlog`/`active`/`wait`/`terminal`).
- `after_create_hook` is intentionally omitted (D4); CloneJobs clone the repos listed in
  `repositories`.

## 7. Deliverable 2 — `elixir/WORKFLOW.macromarkets.example.md`

Front matter changes (only `hooks.after_create`; everything else — `github`, `tracker`, `polling`,
`workspace`, `agent`, `codex`, `claude` — stays as-is):

```yaml
hooks:
  after_create: |
    git clone --depth 1 -b homolog https://github.com/clouapp/front.git front
    git clone --depth 1 -b dev https://github.com/clouapp/back.git back
    cat > front/.env.local <<ENV
    # ...existing .env.local contents, unchanged...
    ENV
```

Prompt body changes:
- New **`## Repositories`** section:
  | Repo | Path | Integration branch | PR base |
  |------|------|--------------------|---------|
  | `clouapp/front` (frontend) | `front/` | `homolog` | `homolog` |
  | `clouapp/back` (backend) | `back/` | `dev` | `dev` |
  - Issues/Project live on `clouapp/front`; a single issue may require changes in either or both repos.
- Update the **Integration branch** section to be per-repo (front merges `origin/homolog`; back
  merges `origin/dev`), and `gh pr create --base homolog` for front PRs vs `--base dev` for back PRs.
- Update **Tests and validation**:
  - Frontend (`front/`): `npm run lint`, `npm run test:unit`; Vitest under `front/tests/`.
  - Backend (`back/`): use `sail`/`vibe` (not bare `php`); run `./vibe test` (or `vendor/bin/pest`);
    follow the backend repo's `AGENTS`/`.cursorrules` and its own PR template.
  - Do not move to Human Review until each touched repo's tests are green and a PR is open against
    that repo's base branch.

## 8. Shared prompt / dev-env content

`prompt_template` (template) and the WORKFLOW prompt body share the same per-repo guidance:

- Repositories table (front/back, path, integration branch, PR base) as in §7.
- Per-repo PR base: `gh pr create --base homolog` (front), `gh pr create --base dev` (back).
- Per-repo tests: front `npm run test:unit` + `npm run lint`; back `./vibe test`.
- Backend conventions: prefer `sail`/`vibe`; commits in English.

`dev_env_markdown` (template only) documents on-demand bring-up:

```
## Frontend (front/)
1. cd front && npm install
2. .env.local is generated on clone (Next.js dev config).
3. npm run dev

## Backend (back/)
1. cd back && make install            # composer install + sail:install + image pull/build (Docker)
2. ./vibe shared up                   # start shared services (pgsql/redis/...)
3. ./vibe up                          # start app container
4. ./vibe artisan migrate --seed
5. ./vibe test                        # Pest
```

## 9. Error handling / edge cases

- `after_create` clone failures (private repo without token, network) surface via the existing hook
  runner; no new handling added.
- The template `validation_commands` use `cd <subdir> && ...`; they are informational metadata and
  are not auto-run by Symphony (consistent with `multi-repo-fullstack.yml`).
- If the operator wants the `macro` branch instead of `dev` for the backend, it is a one-line change
  in both files (`default_branch`/clone `-b`); called out in §4 D3.

## 10. Testing strategy

- `priv/templates/macro-markets.yml` must round-trip through `TemplateYaml.decode/1` without
  `:invalid_yaml`. Add/extend an ExUnit assertion alongside existing template tests
  (`test/symphony_elixir/local_tracker/templates_test.exs` / `template_yaml_test.exs`) if builtin
  templates are covered there; otherwise a focused decode test.
- `WORKFLOW.macromarkets.example.md` must parse via `SymphonyElixir.Workflow` front-matter loader
  (YAML front matter valid; `hooks.after_create` is a string). Verify with the existing workflow
  loading path / `mix` if a smoke test exists.
- Manual: confirm both `git clone` lines produce `front/` and `back/`, and `front/.env.local` is
  written under `front/`.

## 11. Success criteria

1. `priv/templates/macro-markets.yml` decodes cleanly and lists both repos with correct branches
   and `workspace_path`s.
2. `WORKFLOW.macromarkets.example.md` clones both repos into `front/` and `back/`, writes
   `front/.env.local`, and the prompt documents per-repo branches, PR bases, and test commands.
3. The GitHub tracker config (`github.repo: clouapp/front`, project id, `tracker.*`, `agent.*`,
   `codex:`, `claude:`) is unchanged.
4. Existing Symphony behavior is otherwise untouched (no source changes).
