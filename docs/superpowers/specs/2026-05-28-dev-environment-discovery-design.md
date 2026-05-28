# Dev-Environment Discovery & Setup — Design

> Slice D of the **Symphony MVP completion** initiative.
> Sibling specs:
> - Slice A: `2026-05-28-viewer-identity-and-board-filters-design.md`
> - Slice B: `2026-05-28-per-project-tracker-adapter-design.md`
> - Slice C: `2026-05-28-workspace-templates-design.md`

## 1. Problem

After Slice C clones a multi-repo workspace into `~/code/symphony-workspaces/<slug>/`, the operator still has to figure out **how to actually run the thing**:

- Which Node / Erlang / Go version? (`mise install`)
- Which background services? (`docker compose up -d postgres redis`)
- Which env vars are required? (`cp .env.example .env`, fill `STRIPE_KEY`, …)
- Which deps to install? (`pnpm install`, `mix deps.get`, `go mod download`)
- How to run migrations / seeds?
- How to start the dev server / tests?

That knowledge usually lives in scattered places: `README.md`, `mise.toml`, `docker-compose.yml`, ad-hoc Slack messages. Symphony already has a passive `RepositoryScanner` that detects stack hints, but it doesn't produce a **runnable, step-by-step setup**.

Slice D adds a **post-creation dev-env discovery flow** that proposes the setup steps, lets the operator approve / edit them, persists them per project, and runs them inside a project-scoped tmux session through the existing `TerminalChannel` infrastructure.

## 2. Goal

1. After a project (Slice B) and its clones (Slice C) are ready, a **discovery job** runs and produces a draft list of "dev-env steps" per repo + project-wide.
2. **Convention first**: if any cloned repo contains `.symphony/devenv.md` or `.symphony/devenv.yaml`, those files are the canonical source (no heuristic guessing on top).
3. **Heuristic fallback**: when no `.symphony/devenv.*` file is found, the discovery job inspects well-known files (`mise.toml` / `.tool-versions`, `docker-compose.yml`, `.env.example`, `package.json`, `mix.exs`, `go.mod`, `requirements.txt`, `Makefile`, `README.md`) and emits a baseline set of steps.
4. The proposal is **editable**: the user gets a side-by-side view ("Discovered" vs "Current") and can accept, edit, reorder, or drop individual steps before saving.
5. Each saved step has: `id`, `repository_id?`, `description`, `command`, `working_directory`, `category` (e.g., `deps`, `services`, `env`, `migrations`, `tests`), `health_check?` (future), `order`.
6. **Execution**: every step has a "Run" button in the UI that sends the command to a **project-scoped tmux session** managed by the existing `Terminal.Registry`. The session is `sym-project-<slug>` and runs in `Config.workspace_root() / <slug>`. The UI streams output via the existing `TerminalChannel`.
7. **Run-all** runs the steps sequentially, stopping on first non-zero exit (configurable).
8. Per-step status (`pending`, `running`, `succeeded`, `failed`, `skipped`) is persisted; the UI shows a checklist with green/red ticks.
9. Templates (Slice C) carry an opaque `dev_env_markdown` blob today. Slice D **promotes** that to a structured `dev_env_steps` list (the Markdown stays as `notes` for prose context) so templates can ship pre-curated steps.

## 3. Non-goals

- A general-purpose CI runner. Steps are sequential shell commands; no DAG, no matrix, no caching.
- Health checks / drift detection (port reachable, env var set, postgres up). Tracked as future work but the schema reserves the field.
- LLM-driven generation. Slice D is convention-first + heuristic. A future slice can layer "Ask agent to refine" on top.
- Running steps when no tmux binary is available. The UI degrades to read-only "copy command" mode (same as Slice C error path).
- Multi-host execution. Steps run on the Symphony server's host, same as today's per-issue workspace.
- Secret discovery / vault integration. `.env.example` parsing only flags the variable names; users still paste values themselves.
- Editing `.symphony/devenv.md` files from the UI. Those live in the repos themselves; users edit them with their editor.
- Cross-step state passing (e.g., capturing an output variable and reusing it). Steps are independent shell invocations.

## 4. Decisions

| ID | Decision | Notes |
|----|---|---|
| D1 | **Discovery mode** = hybrid, but **convention first**. If any cloned repo contains `.symphony/devenv.md` or `.symphony/devenv.yaml`, that is the canonical source. Otherwise the heuristic scanner produces a draft. | User-confirmed (`convention_first`). |
| D2 | **Execution surface** = embedded terminal (existing `TerminalChannel`). Each step's "Run" sends the command to a project-scoped tmux session `sym-project-<slug>`. | User-confirmed (`execute_in_terminal`). |
| D3 | **Detection scope** = mise/tool versions, docker-compose services, `.env.example`, language-specific deps (`package.json`, `mix.exs`, `go.mod`, `requirements.txt`), README parsing for fenced code blocks tagged `setup`/`bash`/`sh`, plus the convention files. | User asked for "B + README. Talvez exigir um script ou markdown dentro do root". README parsing pulls fenced shell blocks labelled `setup` / heading `## Setup` / `## Development`. |
| D4 | **Trigger** = post-creation. Discovery runs **after** `CloneSupervisor` reports all clones for a project as succeeded. Users can also re-run it manually from the project page. | Aligns with user wording: "agente consulte e proponha após salvar o projeto / repositorio". |
| D5 | **Discovery executor** = pure Elixir module `SymphonyElixir.DevEnv.Discovery` (no LLM). Deterministic. Same input → same proposal. | Keeps Slice D testable + free of external creds. |
| D6 | **Persistence** = new table `local_tracker_dev_env_steps` (per project), plus a `local_tracker_dev_env_runs` table for execution history. Templates (Slice C) gain a `dev_env_steps` list field. | |
| D7 | **`.symphony/devenv.yaml` schema** = structured: `[{description, command, working_directory, category, order}]`. `.symphony/devenv.md` = Markdown with fenced `bash` blocks (each one becomes a step; the heading right before becomes the description). | Both formats supported; YAML wins if both files exist. |
| D8 | **Run-all** policy = sequential, stop on first failure. Toggle (`continue_on_error: true`) per step lets a step be marked optional. | |
| D9 | **Concurrency** = at most one Run-all per project at a time (idempotency lock on the run row). Per-step "Run" buttons are allowed even while Run-all is running (UI disables them but the backend doesn't enforce). | Simple guard with `local_tracker_dev_env_runs.status = "running"` exclusivity. |
| D10 | **Working directory** semantics = absolute when the convention file specifies an absolute path; otherwise `workspace_root/<slug>/<workspace_path>` (workspace_path comes from the matching `Repository`) or just `workspace_root/<slug>` for project-scoped steps. | |
| D11 | **Substitution** in commands = same three tokens as Slice C (`{{slug}}`, `{{name}}`, `{{workspace_root}}`) at save time. No env interpolation beyond shell's own `$VAR` (steps already run inside `sh -lc`). | Consistency. |
| D12 | **README parsing** = a step is generated for each fenced `bash`/`sh` block under a heading matching `/^##?\s+(setup|development|getting started|prerequisites)/i`. Description = heading text; command = block contents; category = inferred (`deps` if `install` in command, `services` if `docker` in command, otherwise `setup`). | Best-effort. README parsing is opt-in per repo (default on); the discovery proposal flags every README-derived step with a `source: "readme"` tag so users can filter them out fast. |

## 5. Architecture

```
                Project + repos cloned (Slice C signals "all succeeded")
                                  │
                                  ▼
                ┌─────────────────────────────────┐
                │  DevEnv.Discovery.run/1         │
                │  - reads .symphony/devenv.*     │
                │    in each cloned repo          │
                │  - if absent, runs heuristic    │
                │  - returns ProposedSteps        │
                └────────────────┬────────────────┘
                                 │ broadcasts "devenv_proposed"
                                 ▼
                ┌─────────────────────────────────┐
                │  UI: DevEnvProposal screen      │
                │  - side-by-side diff            │
                │  - user accepts / edits / drops │
                │  - POST /dev_env/steps          │
                └────────────────┬────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────┐
                │  DevEnv.Steps (DB)              │
                └────────────────┬────────────────┘
                                 │ "Run" / "Run all"
                                 ▼
                ┌─────────────────────────────────┐
                │  DevEnv.Runner                  │
                │  - Terminal.Registry            │
                │    project session              │
                │  - sends command line           │
                │  - reads exit code marker       │
                │  - persists Run row             │
                │  - channel: devenv:<slug>       │
                └─────────────────────────────────┘
```

### 5.1 New modules

- `SymphonyElixir.DevEnv.Discovery` — pure functions:
  - `discover(project) :: {:ok, [ProposedStep.t()]}`
  - `discover_repo(repo, project) :: [ProposedStep.t()]`
  - `convention_sources(repo) :: [{:devenv_yaml, path} | {:devenv_md, path}] | []`
  - `heuristic_steps(repo) :: [ProposedStep.t()]`
- `SymphonyElixir.DevEnv.Steps` (context) — CRUD over `local_tracker_dev_env_steps`.
- `SymphonyElixir.DevEnv.Runner` — GenServer that owns the project's tmux session via `Terminal.Registry` and executes steps:
  - `start_link({project_slug})`
  - `run_step(project_slug, step_id)`
  - `run_all(project_slug, opts)`
- `SymphonyElixir.DevEnv.RunHistory` — persistence layer for the run rows.

### 5.2 Terminal scope extension

`SymphonyElixir.Terminal.Registry` gains:

```elixir
@spec session_name(:project, String.t()) :: String.t()
def session_name(:project, project_slug) when is_binary(project_slug) do
  "sym-project-#{safe_segment(project_slug, "project")}"
end

@spec open_project_session(String.t(), keyword()) :: {:ok, session()} | {:error, term()}
def open_project_session(project_slug, opts \\ []) do
  # cwd = workspace_root / project_slug
  # ensures dir exists (Workspace.ensure_project_workspace/1, see §6.3)
end
```

`Terminal.Registry.send_input/3` is reused — it sends a line of text to the tmux session.

### 5.3 Exit-code marker protocol

Tmux is a pty; we can't read "exit code" directly. The Runner wraps every step's command in a marker pattern:

```sh
( <command> ); printf '\nSYM_EXIT %s STEP=%s RUN=%s\n' "$?" "<step_id>" "<run_id>"
```

The Runner subscribes to the tmux session output via `Tmux.capture_pane/1` (already used by `TerminalChannel`) on a 200 ms tick, looks for the `SYM_EXIT` line tagged with the step + run IDs, parses the integer, and updates the step's status accordingly.

This is the same trick used by existing pty-based runners (Warp, fig). It's not bullet-proof against output that contains the literal `SYM_EXIT` string, so we use a UUID-based marker per run:

```
SYM_EXIT_<run_uuid> <exit_code> STEP=<step_id>
```

Where `<run_uuid>` is a 12-char random string regenerated for every run.

A timeout (`dev_env.step_timeout_ms`, default 10 min) abandons a step that doesn't produce its marker. The Runner then sends `Ctrl-C` to the session and marks the step `failed` with reason `:step_timeout`.

### 5.4 Slice B and C integration

- **Slice B**: dev-env discovery is independent of `tracker_kind`. It looks at the cloned repos on disk, not the tracker.
- **Slice C**: templates' `dev_env_markdown` from Slice C is replaced by `dev_env_steps` (structured list) + `dev_env_notes` (prose). On template instantiation:
  - If template ships `dev_env_steps`, those override discovery. Discovery still runs in the background as a "Refresh suggestions" option (writes to `proposed_steps`, not `saved_steps`).
  - If template ships only `dev_env_notes`, discovery runs and proposes; the notes are shown in the proposal UI as context.

## 6. Backend design

### 6.1 Migration

`priv/repo/migrations/2026MMDDHHMMSS_create_dev_env.exs`:

```elixir
def change do
  create table(:local_tracker_dev_env_steps) do
    add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
    add :repository_id, references(:local_tracker_repositories, on_delete: :nilify_all)
    add :description, :string, null: false
    add :command, :text, null: false
    add :working_directory, :string
    add :category, :string, null: false, default: "setup"
    add :continue_on_error, :boolean, null: false, default: false
    add :source, :string, null: false, default: "manual"   # "convention_yaml" | "convention_md" | "heuristic" | "readme" | "manual" | "template"
    add :order, :integer, null: false, default: 0
    add :health_check, :map                                # reserved for future
    timestamps(type: :utc_datetime_usec)
  end
  create index(:local_tracker_dev_env_steps, [:project_id, :order])

  create table(:local_tracker_dev_env_runs) do
    add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
    add :status, :string, null: false                       # "running" | "succeeded" | "failed" | "canceled"
    add :run_marker, :string, null: false                   # the UUID used in SYM_EXIT_<uuid>
    add :started_at, :utc_datetime_usec
    add :completed_at, :utc_datetime_usec
    add :triggered_by, :string                              # viewer login or "system"
    timestamps(type: :utc_datetime_usec)
  end
  create index(:local_tracker_dev_env_runs, [:project_id, :inserted_at])

  create table(:local_tracker_dev_env_step_runs) do
    add :run_id, references(:local_tracker_dev_env_runs, on_delete: :delete_all), null: false
    add :step_id, references(:local_tracker_dev_env_steps, on_delete: :delete_all), null: false
    add :status, :string, null: false                       # "pending" | "running" | "succeeded" | "failed" | "skipped" | "timeout"
    add :exit_code, :integer
    add :error, :text
    add :started_at, :utc_datetime_usec
    add :completed_at, :utc_datetime_usec
    add :captured_output, :text                             # last N KB; truncated
    timestamps(type: :utc_datetime_usec)
  end
  create unique_index(:local_tracker_dev_env_step_runs, [:run_id, :step_id])

  alter table(:local_tracker_workspace_templates) do
    add :dev_env_steps, :map, null: false, default: %{}     # JSON-encoded list of step attrs
    add :dev_env_notes, :text                               # replaces dev_env_markdown (migration backfills)
  end
end
```

A `data_migrations/` script copies legacy `dev_env_markdown` into `dev_env_notes`.

### 6.2 Discovery: convention loaders

`.symphony/devenv.yaml` (preferred):

```yaml
steps:
  - description: Install tool versions
    command: mise install
    working_directory: .
    category: deps
  - description: Start postgres
    command: docker compose up -d postgres
    working_directory: .
    category: services
  - description: Copy .env
    command: cp .env.example .env
    category: env
    continue_on_error: true
```

`.symphony/devenv.md` (fallback convention):

```markdown
## Install tool versions
```bash
mise install
```

## Start postgres
```bash
docker compose up -d postgres
```
```

The Markdown loader pairs each `## Heading` with the **first** subsequent fenced `bash`/`sh` block. Headings without code blocks are skipped.

If both files exist in the same repo, YAML wins. If two repos both ship convention files, both lists are merged (preserving order, prefixed with the repo's role for clarity in description).

### 6.3 Heuristic loader

```elixir
@spec heuristic_steps(repo, project) :: [ProposedStep.t()]
```

Rules (each independent, may emit 0..N steps per rule):

| Detected | Generates |
|---|---|
| `mise.toml` OR `.tool-versions` exists | `{description: "Install tool versions (#{path})", command: "mise install", working_directory: repo_path, category: deps, source: heuristic}` |
| `docker-compose.yml` and at least one of `postgres`/`mysql`/`redis`/`mongo` in services | `{description: "Start required services", command: "docker compose up -d #{services}", working_directory: repo_path, category: services}` |
| `.env.example` exists | `{description: "Copy .env from example", command: "cp .env.example .env", working_directory: repo_path, category: env, continue_on_error: true}` plus a non-runnable advisory step listing missing variables (rendered in UI but `runnable: false`). |
| `package.json` exists | `{description: "Install node deps", command: "#{package_manager} install", working_directory: repo_path, category: deps}` |
| `mix.exs` exists | `{description: "Install Elixir deps", command: "mix deps.get", working_directory: repo_path, category: deps}`, plus migrations: `{description: "Run migrations", command: "mix ecto.create && mix ecto.migrate", working_directory: repo_path, category: migrations, continue_on_error: true}` |
| `go.mod` exists | `{description: "Download Go modules", command: "go mod download", working_directory: repo_path, category: deps}` |
| `requirements.txt` OR `pyproject.toml` exists | A Python-flavoured step (`pip install -r requirements.txt` or `poetry install`) depending on which is present. |
| `Makefile` exists with target `setup`/`install`/`bootstrap` | `{description: "Run make #{target}", command: "make #{target}", working_directory: repo_path, category: setup}` |
| `README.md` contains heading `## Setup` (or aliases per §4 D12) | One step per fenced bash block under that heading, source = `"readme"`. |

Ordering: services → env → tool versions → deps → migrations → setup → README → tests.

The output is a `ProposedStep` list. Nothing is persisted yet; the proposal is returned through a JSON endpoint (§6.5) and broadcast on `devenv:<slug>`.

### 6.4 Runner

```elixir
defmodule SymphonyElixir.DevEnv.Runner do
  use GenServer

  def start_link({project_slug}) do
    GenServer.start_link(__MODULE__, project_slug, name: via(project_slug))
  end

  def run_step(project_slug, step_id, viewer_login) do
    GenServer.call(via(project_slug), {:run_step, step_id, viewer_login}, :infinity)
  end

  def run_all(project_slug, opts) do
    GenServer.call(via(project_slug), {:run_all, opts}, :infinity)
  end

  # internal:
  #  - opens tmux session via Terminal.Registry.open_project_session/1
  #  - send_input(session_name, "cd <wd> && (<command>); printf 'SYM_EXIT_<uuid> %s STEP=<sid>\\n' \"$?\"\n")
  #  - polls capture_pane every 200 ms, parses the marker
  #  - updates step_runs row + broadcasts on devenv:<slug>
  #  - timeout = Application.get_env(:symphony_elixir, :dev_env_step_timeout_ms, 600_000)
end
```

Broadcast event names: `step_started`, `step_succeeded`, `step_failed`, `step_timeout`, `run_started`, `run_completed`, `output_chunk`.

`output_chunk` carries 4 KB-max chunks of fresh terminal output keyed by `run_id` so the UI can render a compact log alongside the steps list (without subscribing to the full `terminal:` channel).

### 6.5 Routes

```
get    /api/tracker/v1/projects/:slug/dev_env/proposal      → Discovery.discover/1 (no persistence)
post   /api/tracker/v1/projects/:slug/dev_env/refresh       → trigger Discovery + broadcast
get    /api/tracker/v1/projects/:slug/dev_env/steps         → Steps.list_for_project
post   /api/tracker/v1/projects/:slug/dev_env/steps         → Steps.replace_for_project (bulk-overwrite)
patch  /api/tracker/v1/projects/:slug/dev_env/steps/:id     → Steps.update_step
delete /api/tracker/v1/projects/:slug/dev_env/steps/:id     → Steps.delete_step
post   /api/tracker/v1/projects/:slug/dev_env/runs          → Runner.run_all
post   /api/tracker/v1/projects/:slug/dev_env/runs/:run_id/cancel → Runner.cancel
get    /api/tracker/v1/projects/:slug/dev_env/runs          → RunHistory.list
get    /api/tracker/v1/projects/:slug/dev_env/runs/:run_id  → RunHistory.show (with step_runs)
post   /api/tracker/v1/projects/:slug/dev_env/steps/:id/run → Runner.run_step (single step)
```

### 6.6 Integration with Slice C templates

`Templates.save_project_as_template/2` now captures `dev_env_steps` (a snapshot of the project's saved steps) and `dev_env_notes` (free-form Markdown). `Templates.instantiate_template/2` writes those into the new project's steps table (with auto-assigned IDs and order preserved). After clone-jobs finish, discovery still runs but writes to a "proposal" view that the user can compare against the template's steps and merge selectively.

## 7. Frontend design

### 7.1 Project page additions

A new "Dev environment" tab appears in `ProjectHeader.tsx` between "Board" and "Settings". Empty state (no saved steps yet):

```
┌──────────────────────────────────────────────────────┐
│  No dev-env steps yet.                                │
│  [ Run discovery ]   [ Add manual step ]              │
└──────────────────────────────────────────────────────┘
```

After discovery runs:

```
┌──────────────────────────────────────────────────────┐
│  Proposed steps                              [Edit]   │
│  ─────────────────────────────────────────────────    │
│  ◐ Install tool versions    (deps, heuristic)         │
│      mise install            ./goapi                   │
│      [ ✓ Accept ]  [ ✏ Edit ]  [ ✗ Drop ]              │
│  ◯ Start postgres            (services, heuristic)    │
│      docker compose up -d postgres                     │
│      ...                                               │
└──────────────────────────────────────────────────────┘
```

After saving:

```
┌──────────────────────────────────────────────────────┐
│  Dev environment        [Run all]  [Refresh]          │
│  ─────────────────────────────────────────────────    │
│  ✅ Install tool versions    succeeded · 12s            │
│  ⚙  Start postgres            running…                 │
│  ⏳ Install node deps         pending                  │
│  ─────────────────────────────────────────────────    │
│  ◀ Live output (last run · run_id #...)               │
└──────────────────────────────────────────────────────┘
```

### 7.2 Components

- `tracker/src/components/devenv/DevEnvProposal.tsx` — side-by-side editor.
- `tracker/src/components/devenv/DevEnvStepList.tsx` — saved steps with Run / Run-all / drag-reorder.
- `tracker/src/components/devenv/DevEnvLiveOutput.tsx` — virtualized log viewer fed by `output_chunk` events.
- `tracker/src/components/devenv/StepEditor.tsx` — modal for editing one step.
- `tracker/src/hooks/useDevEnv.ts` — subscribes to `devenv:<project_slug>` channel, reduces events into `{ proposal, steps, currentRun, lastRun, output }`.

### 7.3 Service layer

`tracker/src/services/devEnv.ts`:

```ts
export interface DevEnvStep {
  id: string;
  description: string;
  command: string;
  workingDirectory: string | null;
  category: "setup" | "deps" | "services" | "env" | "migrations" | "tests" | "other";
  continueOnError: boolean;
  source: "convention_yaml" | "convention_md" | "heuristic" | "readme" | "manual" | "template";
  order: number;
  repositoryId: string | null;
}

export interface DevEnvProposal {
  proposed: DevEnvStep[];
  saved: DevEnvStep[];
  notes: string | null;
}

export interface DevEnvRun {
  id: string;
  status: "running" | "succeeded" | "failed" | "canceled";
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string;
  stepRuns: DevEnvStepRun[];
}

export interface DevEnvStepRun {
  id: string;
  stepId: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "timeout";
  exitCode: number | null;
  startedAt: string | null;
  completedAt: string | null;
  capturedOutput: string;
}

export async function getDevEnvProposal(slug: string): Promise<DevEnvProposal>;
export async function refreshDevEnvProposal(slug: string): Promise<void>;
export async function listDevEnvSteps(slug: string): Promise<DevEnvStep[]>;
export async function replaceDevEnvSteps(slug: string, steps: DevEnvStepInput[]): Promise<DevEnvStep[]>;
export async function updateDevEnvStep(slug: string, id: string, input: Partial<DevEnvStepInput>): Promise<DevEnvStep>;
export async function deleteDevEnvStep(slug: string, id: string): Promise<void>;
export async function startDevEnvRun(slug: string, opts: { stopOnError: boolean }): Promise<DevEnvRun>;
export async function runDevEnvStep(slug: string, id: string): Promise<DevEnvStepRun>;
export async function cancelDevEnvRun(slug: string, runId: string): Promise<void>;
export async function listDevEnvRuns(slug: string): Promise<DevEnvRun[]>;
export async function getDevEnvRun(slug: string, runId: string): Promise<DevEnvRun>;
```

### 7.4 Channel integration

`useDevEnv` joins `devenv:<slug>` over the existing socket. Payloads mirror the backend events. The live-output panel virtualises the last 2 000 lines; older lines are written to memory only and fetched on demand from `getDevEnvRun(slug, runId).capturedOutput` (the backend truncates per step at 64 KB).

### 7.5 Template editor integration (Slice C handoff)

`TemplateForm.tsx` gains a "Dev environment" section with the same step-editor primitives. Templates that include `dev_env_steps` show the steps as the first thing the operator sees after instantiation; discovery proposal becomes a sidebar "Refresh suggestions" affordance instead of the primary flow.

### 7.6 Read-only mode

If `GET /api/tracker/v1/dev_env/capabilities` returns `terminal_available: false` (no tmux binary on the server), the UI hides the Run / Run-all buttons and renders each step as a "Copy command" card. Saved steps still work for reference. Errors from the runner about tmux are mapped to `terminal_unavailable` and surface this fallback automatically.

## 8. Migration & backward compatibility

- Schema additions only; no destructive changes.
- Slice C's `dev_env_markdown` is migrated to `dev_env_notes` in the same Slice D migration. Existing templates keep their prose.
- Projects without saved steps see the "No dev-env steps yet" empty state. Running discovery is opt-in.
- The new tmux session name (`sym-project-<slug>`) does not collide with the existing issue-scoped sessions (`sym-issue-<slug>-<issue>`).

## 9. Error handling

| Error | HTTP | code | message |
|---|---|---|---|
| tmux binary missing | 503 | `terminal_unavailable` | "tmux is required to run steps; install it on the Symphony host" |
| project missing | 404 | `project_not_found` | |
| step missing | 404 | `step_not_found` | |
| run already in progress | 409 | `dev_env_run_in_progress` | with `details.run_id` |
| step run timed out | runner result | `step_timeout` | broadcast event |
| step non-zero exit | runner result | `step_failed` | broadcast event with `exit_code`, `captured_output` |
| convention file YAML invalid | per-repo, surfaced as a `proposal_warning` on the proposal payload | n/a | UI shows red banner with file path + line |
| heuristic produces zero steps | 200 with empty list | n/a | UI shows manual-step CTA |
| step command empty | 422 | `step_command_required` | |
| working_directory escapes workspace root | 422 | `step_working_directory_invalid` | reuses `Workspace.validate_workspace_path/1` |

## 10. Testing strategy

### 10.1 Backend (ExUnit)

- `SymphonyElixir.DevEnv.DiscoveryTest`
  - convention YAML loader
  - convention MD loader (heading + bash fence pairing)
  - heuristic rules per detected file (one test per row of §6.3)
  - README parser
  - precedence: YAML > MD > heuristic, with merging across repos
- `SymphonyElixir.DevEnv.StepsTest` — CRUD + bulk replace ordering.
- `SymphonyElixir.DevEnv.RunnerTest`
  - happy path with mocked tmux (`Application.put_env(:symphony_elixir, :terminal_tmux, MockTmux)`).
  - marker parsing (correct UUID, wrong UUID, mixed output).
  - step timeout sends Ctrl-C and marks `:step_timeout`.
  - run-all stops on first failure when `continue_on_error: false`.
  - run-all continues past failure when step has `continue_on_error: true`.
  - concurrent run-all rejected with `dev_env_run_in_progress`.
- `SymphonyElixir.DevEnv.RunHistoryTest`.
- Controller tests for all 10 routes in §6.5.
- Channel test for `devenv:<slug>` broadcasts.
- Integration: end-to-end with a fake convention YAML file written into a temp dir and a stubbed tmux that echoes the SYM_EXIT marker.

### 10.2 Frontend (Vitest + RTL)

- `tracker/src/services/__tests__/devEnv.test.ts` — every method's axios payload.
- `tracker/src/components/devenv/__tests__/DevEnvProposal.test.tsx` — accept / edit / drop + bulk save.
- `tracker/src/components/devenv/__tests__/DevEnvStepList.test.tsx` — Run / Run-all / drag reorder.
- `tracker/src/components/devenv/__tests__/StepEditor.test.tsx` — validation (command required).
- `tracker/src/components/devenv/__tests__/DevEnvLiveOutput.test.tsx` — append `output_chunk`, virtualisation.
- `tracker/src/hooks/__tests__/useDevEnv.test.tsx` — channel join + reducer transitions for all 7 events.

### 10.3 End-to-end smoke (manual)

1. Create a project from scratch (no `.symphony/devenv.*`) with a single Elixir + Postgres repo → discovery proposes `mix deps.get`, `docker compose up -d postgres`, `mix ecto.migrate`.
2. Add `.symphony/devenv.yaml` to one repo; refresh → those steps replace the heuristic ones for that repo.
3. Run all → step output streams; failure mid-run stops the chain unless `continue_on_error`.
4. Cancel a long-running step → marker arrives, status `canceled`.
5. Stop the tmux binary on the host → UI degrades to read-only "copy command".
6. Save a project as template (Slice C) → instantiate elsewhere → steps materialise immediately and discovery becomes a secondary "Refresh suggestions" action.

## 11. Open questions / future work

- **Health checks** (port, env var, command exit code) for drift detection: schema reserved; UI placeholder; logic deferred.
- **Output capture limits** beyond 64 KB / step. Stream-to-disk for very large logs.
- **Per-step env vars** injected at run time.
- **Run-as user / sudo** support.
- **Multi-host setups** (steps that run on a remote machine via SSH).
- **LLM-assisted refine** ("Ask agent to improve this proposal"): a future slice that posts the repo files to a Codex/Claude session and merges results into the proposal.
- **Convention file generators**: a UI button "Save these steps as `.symphony/devenv.yaml`" that writes the file back into a chosen repo (and stages it for commit).
- **Cross-project orchestration** (e.g., "if project A's postgres step succeeded, project B can skip its postgres").

## 12. Success criteria

A reviewer should be able to:

1. Create a project with repos that have `.symphony/devenv.yaml` and see those steps loaded verbatim.
2. Create a project with repos that have only `README.md` + `mise.toml` + `docker-compose.yml` and see a sensible heuristic proposal.
3. Accept the proposal, edit one step, and save.
4. Click "Run all" and watch each step turn green; see live output stream into the side panel.
5. Trigger a failing step (`continue_on_error = false`) and confirm the run stops and surfaces the captured output.
6. Cancel a hanging step and confirm the marker arrives and the step is marked `canceled`.
7. Save the project as a template (Slice C); instantiate on a fresh checkout and confirm steps materialise + discovery proposes a refresh.
8. Run the full `mix test` + `pnpm test` suite green.
