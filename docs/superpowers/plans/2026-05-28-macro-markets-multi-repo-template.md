# Macro Markets Multi-Repo Template Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo's real tools.

**Goal:** Add a builtin Macro Markets workspace template (front + back) and convert the example workflow to multi-repo, without changing Symphony source.

**Architecture:** Two static-asset changes. (1) A new `priv/templates/macro-markets.yml` decoded by the existing `TemplateYaml`/`import_builtins` path. (2) `WORKFLOW.macromarkets.example.md` front matter `hooks.after_create` clones both repos into `front/` and `back/`; prompt body documents per-repo branches, PR bases, and tests. Tracker stays on `clouapp/front`.

**Tech Stack:** Elixir (ExUnit, `mix`), YAML (`YamlElixir`), Markdown front matter.

**Spec:** `docs/superpowers/specs/2026-05-28-macro-markets-multi-repo-template-design.md`

---

## File Structure

- Create: `elixir/priv/templates/macro-markets.yml` — builtin template (front + back repos, statuses, prompt, dev-env).
- Modify: `elixir/WORKFLOW.macromarkets.example.md:43-85` (`hooks.after_create`) + prompt body (Repositories, Integration branch, Tests sections).
- Modify (test): `elixir/test/symphony_elixir/local_tracker/templates_test.exs:227-237` — extend the builtins test to assert the `macro-markets` slug and its two repos.

Working dir for all commands: `elixir/`.

---

### Task 1: Builtin `macro-markets.yml` template

**Files:**
- Create: `elixir/priv/templates/macro-markets.yml`
- Test: `elixir/test/symphony_elixir/local_tracker/templates_test.exs:227-237`

- [ ] **Step 1: Extend the failing test** — update the existing `import_builtins seeds templates idempotently` test to also assert the new builtin and its repositories.

In `elixir/test/symphony_elixir/local_tracker/templates_test.exs`, replace the body of the `"import_builtins seeds templates idempotently"` test with:

```elixir
  test "import_builtins seeds templates idempotently" do
    assert :ok = Templates.import_builtins()
    templates = Templates.list_templates()
    slugs = Enum.map(templates, & &1.slug)
    assert "single-repo-elixir" in slugs
    assert "multi-repo-fullstack" in slugs
    assert "macro-markets" in slugs

    macro = Enum.find(templates, &(&1.slug == "macro-markets"))
    repo_paths = macro.repositories |> Enum.map(& &1.workspace_path) |> Enum.sort()
    assert repo_paths == ["back", "front"]
    branches = macro.repositories |> Enum.map(& &1.default_branch) |> Enum.sort()
    assert branches == ["dev", "homolog"]

    # Idempotent: second run does not duplicate
    assert :ok = Templates.import_builtins()
    count = Templates.list_templates() |> Enum.count(&(&1.slug == "macro-markets"))
    assert count == 1
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mix test test/symphony_elixir/local_tracker/templates_test.exs -o "import_builtins seeds templates idempotently"`
(or run the whole file: `mix test test/symphony_elixir/local_tracker/templates_test.exs`)
Expected: FAIL — `"macro-markets" in slugs` is false (file does not exist yet).

- [ ] **Step 3: Create the template file**

Create `elixir/priv/templates/macro-markets.yml`:

```yaml
slug: macro-markets
name: Macro Markets
description: Macro Markets workspace — Next.js frontend (clouapp/front) + Laravel backend (clouapp/back).
validation_commands:
  - cd front && npm run lint
  - cd front && npm run test:unit
  - cd back && ./vibe test
workflow_statuses:
  - name: Backlog
    category: backlog
    position: 0
    is_terminal: false
  - name: Todo
    category: active
    position: 1
    is_terminal: false
  - name: In Progress
    category: active
    position: 2
    is_terminal: false
  - name: Human Review
    category: wait
    position: 3
    is_terminal: false
  - name: Rework
    category: active
    position: 4
    is_terminal: false
  - name: Merging
    category: active
    position: 5
    is_terminal: false
  - name: Done
    category: terminal
    position: 6
    is_terminal: true
  - name: Cancelled
    category: terminal
    position: 7
    is_terminal: true
  - name: Duplicate
    category: terminal
    position: 8
    is_terminal: true
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
  You are working in the Macro Markets multi-repository workspace.

  Repositories:
  - frontend: clouapp/front at `front/` — integration branch `homolog`; open PRs with `gh pr create --base homolog`.
  - backend: clouapp/back at `back/` — integration branch `dev`; open PRs with `gh pr create --base dev`.

  A single issue may touch either or both repos. Issues and the Project board live on clouapp/front.

  Tests before Human Review (only for repos you changed):
  - frontend: `cd front && npm run lint && npm run test:unit`
  - backend: `cd back && ./vibe test` (equivalently `vendor/bin/pest`)

  Backend conventions: prefer `sail`/`vibe` over bare `php`; commit messages in English.
dev_env_markdown: |
  ## Frontend (front/)
  1. `cd front && npm install`
  2. `.env.local` is generated on clone (Next.js dev config).
  3. `npm run dev`

  ## Backend (back/)
  1. `cd back && make install`   # composer install + sail:install + image pull/build (Docker)
  2. `./vibe shared up`          # start shared services (pgsql/redis/...)
  3. `./vibe up`                 # start the app container
  4. `./vibe artisan migrate --seed`
  5. `./vibe test`               # Pest
metadata:
  source: builtin
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mix test test/symphony_elixir/local_tracker/templates_test.exs`
Expected: PASS (all tests in file, including the extended builtins test).

- [ ] **Step 5: Verify YAML decodes via the real loader** (extra safety, not a new test)

Run:
```bash
mix run -e 'path = Path.join(:code.priv_dir(:symphony_elixir), "templates/macro-markets.yml"); {:ok, yaml} = File.read(path); {:ok, attrs} = SymphonyElixir.LocalTracker.TemplateYaml.decode(yaml); IO.inspect(Map.get(attrs, "slug")); IO.inspect(length(Map.get(attrs, "repositories")))'
```
Expected: prints `"macro-markets"` and `2`.

- [ ] **Step 6: Commit**

```bash
git add elixir/priv/templates/macro-markets.yml elixir/test/symphony_elixir/local_tracker/templates_test.exs
git commit -m "feat: add Macro Markets multi-repo workspace template"
```

---

### Task 2: Make `WORKFLOW.macromarkets.example.md` multi-repo

**Files:**
- Modify: `elixir/WORKFLOW.macromarkets.example.md:43-85` (`hooks.after_create`)
- Modify: `elixir/WORKFLOW.macromarkets.example.md` prompt body (Repositories / Integration branch / Tests sections)

- [ ] **Step 1: Update `hooks.after_create` to clone both repos**

Replace the current `hooks:` block (lines 43–85, which clones `clouapp/front` into `.` and writes `.env.local`) with a version that clones into `front/` and `back/` and writes `front/.env.local`:

```yaml
hooks:
  after_create: |
    git clone --depth 1 -b homolog https://github.com/clouapp/front.git front
    git clone --depth 1 -b dev https://github.com/clouapp/back.git back
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
```

Leave the `github:`, `tracker:`, `polling:`, `workspace:`, `agent:`, `codex:`, `claude:` sections unchanged. Keep the commented `local:` dogfood note.

- [ ] **Step 2: Add a `## Repositories` section to the prompt body**

After the intro paragraph that ends with "...define what you must do next." (currently line 108), and replacing/expanding the existing `## Integration branch (`homolog`)` section (lines 110–116), insert:

```markdown
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
```

(Delete the old single-repo `## Integration branch (`homolog`)` block since the table above supersedes it.)

- [ ] **Step 3: Update the Tests/validation section for both repos**

In the `## Tests and validation (mandatory)` section (lines 161–175), make the commands per-repo. Replace the frontend-only bullets with:

```markdown
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
```

- [ ] **Step 4: Verify the front matter still parses**

Run:
```bash
mix run -e 'content = File.read!("WORKFLOW.macromarkets.example.md"); [_, fm | _] = String.split(content, "---\n", parts: 3); {:ok, parsed} = YamlElixir.read_from_string(fm); IO.inspect(get_in(parsed, ["github", "repo"])); IO.inspect(String.contains?(get_in(parsed, ["hooks", "after_create"]), "clouapp/back"))'
```
Expected: prints `"clouapp/front"` and `true`.

- [ ] **Step 5: Sanity-check the example doesn't break existing tests that read it**

Run: `mix test test/symphony_elixir/core_test.exs test/symphony_elixir/workspace_and_config_test.exs`
Expected: PASS (these reference example workflows / after_create; confirm no regressions).

- [ ] **Step 6: Commit**

```bash
git add elixir/WORKFLOW.macromarkets.example.md
git commit -m "feat: make Macro Markets example workflow multi-repo (front + back)"
```

---

### Task 3: Full gate

- [ ] **Step 1: Run the focused suites**

Run: `mix test test/symphony_elixir/local_tracker/templates_test.exs test/symphony_elixir/local_tracker/template_yaml_test.exs`
Expected: PASS.

- [ ] **Step 2: Run format + project gate** (per `elixir/AGENTS.md`)

Run: `mix format && mix test`
Expected: format clean; full suite PASS. (Optionally `make all` for lint/coverage/dialyzer before PR.)

- [ ] **Step 3: Commit any format-only changes** (if `mix format` touched files)

```bash
git add -A
git commit -m "chore: mix format"
```

---

## Self-Review

**Spec coverage:**
- Deliverable 1 (template) → Task 1. Includes repos, branches, statuses, validation_commands, prompt, dev_env, `source: builtin`, omitted `after_create_hook`.
- Deliverable 2 (WORKFLOW multi-repo) → Task 2 (clone both repos, write `front/.env.local`, per-repo branches/PR bases/tests, tracker unchanged).
- No-source-change non-goal → respected (only `priv/templates`, the example `.md`, and one test).
- D3 backend branch `dev` → Task 1 (`default_branch: dev`) + Task 2 (`-b dev`, base `dev`).
- D4 clone-only hook → Task 1 omits `after_create_hook`; Task 2 hook only clones + writes `.env.local`.
- Testing strategy (template round-trip + workflow parse) → Task 1 Steps 4–5, Task 2 Step 4, Task 3.

**Placeholder scan:** none — every step has concrete YAML/Markdown/commands and expected output.

**Type consistency:** template keys (`slug`, `name`, `validation_commands`, `workflow_statuses`, `repositories[*]`, `metadata`) match `TemplateYaml.normalize/1` recognized keys and `WorkspaceTemplate`/`WorkspaceTemplateRepository` fields used in `templates_test.exs`.
