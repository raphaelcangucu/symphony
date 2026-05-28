# Workspace Templates — Design

> Slice C of the **Symphony MVP completion** initiative.
> Sibling specs:
> - Slice A: `2026-05-28-viewer-identity-and-board-filters-design.md`
> - Slice B: `2026-05-28-per-project-tracker-adapter-design.md`
> - Slice D: `2026-05-28-dev-environment-discovery-design.md` (next)

## 1. Problem

Symphony already supports **multi-repository projects** (`local_tracker_repositories`) and per-project `ProjectSetup` (workflow_config, after_create_hook, prompt_template, validation_commands). But every new project starts from a blank wizard run:

- The user re-picks the same set of repos (e.g., `gamba-workspace` is _always_ `goapi + frontend + backend`).
- The same hooks / validation commands have to be re-derived by `WorkflowSuggester` each time.
- There is no way to share a known-good workspace blueprint across machines or with a teammate.
- A new project never gets its repos cloned; cloning today happens lazily per **issue** via the `after_create` hook on `~/code/symphony-workspaces/<repo>/<issue-id>`. There is no project-level "set up the workspace once" pipeline.

Slice C introduces **Workspace Templates**: a reusable, versionable description of a multi-repo workspace that can be applied to instantiate a project with one click + a background clone job.

## 2. Goal

1. Add a first-class **Template** entity (`local_tracker_workspace_templates`) capturing repos, hooks, validation commands, prompt template, workflow statuses, and optional dev-env section (Slice D plugs in here).
2. Let users **save an existing project as a template** ("Save as template" button on the project page) — captures the current `Repository` and `ProjectSetup` records, allows refinement, and stores it.
3. Let users **manually edit** templates (list page, edit form).
4. Let users **import / export** templates as YAML for sharing across machines and teammates.
5. Let users **instantiate a project from a template** as a new step at the top of `ProjectWorkspaceWizard` ("Start from a template" tab).
6. On instantiation, schedule a **project-level clone job** that clones every repo into a per-project root under `Config.workspace_root()` and reports progress via a Phoenix Channel. The clone is async, resumable, and idempotent.
7. Keep everything **Slice B-aware**: templates have no opinion on `tracker_kind`. A template applied with `tracker_kind = "github"` ignores `workflow_statuses` (statuses come from the remote) but still uses repos + hooks + prompt_template.

## 3. Non-goals

- Per-template tokens, secrets, or env vars. Tokens stay global (Slice A).
- Conditional / templating language inside hooks (`{{ slug }}` substitution is the only thing we support — see §6.5). No Liquid, no ERB, no eval.
- A registry / marketplace. Templates are local DB + YAML files; sharing is "send me your YAML" or `git` your `~/.config/symphony/templates`.
- Versioning / migrations for templates. A template is a snapshot; if a user edits it, all future instantiations use the new version. Past projects are unaffected.
- Re-applying a template to an existing project ("upgrade my project to template v2"). Out of scope.
- Cloning into existing non-empty directories. The clone job refuses to overwrite.
- Clone of forks / private repos that the user's `GITHUB_TOKEN` cannot access — surfaced as a structured error per repo (see §9), the job moves on.
- Linear / GitHub Project metadata is **not** baked into templates. Templates capture the workspace shape, not the tracker shape (Slice B owns tracker shape).
- Editing template **after** it has been applied: edits are independent; existing projects do not inherit edits.

## 4. Decisions

| ID | Decision | Notes |
|----|---|---|
| D1 | **Storage** = SQLite (`local_tracker_workspace_templates`) as source-of-truth, with import/export to/from YAML files. | User skipped; assumed. Best of both: local persistence + portability. YAML files live under `~/.config/symphony/templates/` by default (configurable). |
| D2 | **Authoring** = "Save as template" button on the project page + manual edit form. | User skipped; assumed. Both flows write to the same DB row. |
| D3 | **Cloning** = async background `CloneJob` per repo, broadcast via `Phoenix.Channel` (`templates:<project_slug>` topic). UI shows progress bars. | User skipped; assumed. Synchronous blocking (option A) creates terrible UX for big repos. |
| D4 | **Template scope** = repos + hooks + prompt_template + validation_commands + workflow_statuses (used only when applied to local trackers). Dev-env section is a free-form Markdown blob that Slice D will render. | Templates do not carry tracker_kind. The Slice B wizard picks tracker_kind independently. |
| D5 | **Substitution** = the strings `{{slug}}`, `{{name}}`, `{{workspace_root}}` are substituted in `clone_url`, `workspace_path`, `after_create_hook`, `before_run`, `prompt_template`, and the dev-env Markdown blob at apply time. No other expressions. | Keeps templates safe; no eval, no logic. |
| D6 | **Identifiers** = `slug` (unique, `gamba-workspace`) + human `name`. Slug used in URLs and YAML filenames. | |
| D7 | **Clone destination** = `Config.workspace_root() / <project.slug> / <repository.workspace_path>`. Each project has a dedicated subtree; per-issue workspaces created by `Workspace.create_for_issue/1` continue under `Config.workspace_root() / <issue.identifier>` (separate). | Project-level clone is for the operator's convenience; agents still get their isolated per-issue clones. |
| D8 | **Built-in templates** = ship two examples at first run: `single-repo-elixir` and `multi-repo-fullstack`. They live as YAML files in `priv/templates/` and are imported into the DB on first start if no template with that slug exists. | Gives users a working starting point without auth. |
| D9 | **Clone executor** = `git clone --depth 1 --branch <branch>` via `System.cmd("git", ...)` with `cd: workspace_root`. Token injection for private repos uses `https://x-access-token:$GITHUB_TOKEN@github.com/...`. | Reuses the existing approach in `WorkflowSuggester.after_create_hook/1`. Depth-1 keeps it fast; users can `git fetch --unshallow` later if needed. |
| D10 | **Idempotency** = re-running a clone job for a repo whose directory already exists + is a valid git repo at the right URL is a no-op (logged "already cloned"). Otherwise the job fails for that repo with `:clone_destination_exists`. | Prevents accidental data loss. |
| D11 | **Permission model** = same as everything else: any caller holding the `tracker_token` can create/list/apply templates. | Single-user assumption per Slice A. |
| D12 | **`tracker_config` for non-local** is not part of the template. Users still pick the GitHub Project v2 board or Linear project in the wizard's Slice B step. | Keeps Slice C orthogonal to Slice B. |

## 5. Architecture

```
                                      (Slice C)
                          ┌─────────────────────────────┐
                          │   WorkspaceTemplate (DB)    │
                          │   + import/export YAML      │
                          └──────────────┬──────────────┘
                                         │
                              applies to │
                                         ▼
                          ┌─────────────────────────────┐
                          │  ProjectWorkspaceWizard     │
                          │  "Start from a template"    │
                          │  step                        │
                          └──────────────┬──────────────┘
                                         │
                                         ▼
                          ┌─────────────────────────────┐
                          │  Context.create_workspace_  │
                          │  project_from_template/2     │
                          │  (transactional)             │
                          └──────────────┬──────────────┘
                                         │
                          ┌──────────────┴──────────────┐
                          ▼                             ▼
              ┌─────────────────────┐       ┌─────────────────────┐
              │ Project + Repos +   │       │ CloneJob GenServer  │
              │ ProjectSetup        │       │  per repo           │
              │ (synchronous)       │       │  → Phoenix Channel  │
              └─────────────────────┘       └─────────────────────┘
```

### 5.1 New persistence

`SymphonyElixir.LocalTracker.WorkspaceTemplate` (new schema)

```elixir
schema "local_tracker_workspace_templates" do
  field :name, :string
  field :slug, :string
  field :description, :string
  field :workflow_statuses, {:array, :map}, default: []       # same shape as WorkflowSuggester
  field :validation_commands, {:array, :string}, default: []
  field :after_create_hook, :string                            # raw shell with {{slug}} placeholders
  field :before_run_hook, :string
  field :after_run_hook, :string
  field :before_remove_hook, :string
  field :prompt_template, :string
  field :dev_env_markdown, :string                             # Slice D plugs in here
  field :metadata, :map, default: %{}                          # source ("manual" | "saved_from_project" | "imported")
  has_many :repositories, SymphonyElixir.LocalTracker.WorkspaceTemplateRepository, on_delete: :delete_all
  timestamps(type: :utc_datetime_usec)
end
```

`SymphonyElixir.LocalTracker.WorkspaceTemplateRepository` (new schema)

```elixir
schema "local_tracker_workspace_template_repositories" do
  field :github_full_name, :string
  field :clone_url, :string                                    # may contain {{slug}}
  field :default_branch, :string
  field :workspace_path, :string                               # may contain {{slug}}
  field :role, :string
  belongs_to :template, SymphonyElixir.LocalTracker.WorkspaceTemplate
  timestamps(type: :utc_datetime_usec)
end
```

`SymphonyElixir.LocalTracker.CloneJob` (new schema — for resumable progress)

```elixir
schema "local_tracker_clone_jobs" do
  field :status, :string                                       # "pending" | "running" | "succeeded" | "failed" | "skipped"
  field :error, :string                                        # nil unless failed
  field :started_at, :utc_datetime_usec
  field :completed_at, :utc_datetime_usec
  field :commit_sha, :string
  belongs_to :project, SymphonyElixir.LocalTracker.Project
  belongs_to :repository, SymphonyElixir.LocalTracker.Repository
  timestamps(type: :utc_datetime_usec)
end
```

Indexes:

- Unique `(:slug)` on templates.
- Unique `(:project_id, :repository_id)` on clone_jobs.

### 5.2 Public boundary

A new `SymphonyElixir.LocalTracker.Templates` context module (kept separate from `LocalTracker.Context` to avoid bloating it):

```elixir
@spec list_templates() :: [WorkspaceTemplate.t()]
@spec get_template(String.t()) :: {:ok, WorkspaceTemplate.t()} | {:error, :template_not_found}
@spec create_template(map()) :: {:ok, WorkspaceTemplate.t()} | {:error, Ecto.Changeset.t()}
@spec update_template(String.t(), map()) :: {:ok, WorkspaceTemplate.t()} | {:error, ...}
@spec delete_template(String.t()) :: {:ok, WorkspaceTemplate.t()} | {:error, ...}
@spec save_project_as_template(String.t(), map()) :: {:ok, WorkspaceTemplate.t()} | {:error, ...}
@spec instantiate_template(String.t(), map()) :: {:ok, Project.t()} | {:error, ...}
@spec import_yaml(binary()) :: {:ok, WorkspaceTemplate.t()} | {:error, ...}
@spec export_yaml(String.t()) :: {:ok, binary()} | {:error, ...}
```

### 5.3 Clone supervisor

`SymphonyElixir.LocalTracker.CloneSupervisor` (new) — a `DynamicSupervisor` that spawns one `CloneWorker` GenServer per repo.

```
SymphonyElixir.Application children
└── DynamicSupervisor (strategy: :one_for_one, name: CloneSupervisor)
```

`SymphonyElixir.LocalTracker.CloneWorker` (GenServer)

- `start_link({clone_job_id})`
- On init: marks `CloneJob` as `running`, broadcasts `clone_started` over `templates:<project_slug>`.
- Performs `git clone --depth 1 --branch <branch> <clone_url> <dest>`.
- On success: records `commit_sha`, marks `succeeded`, broadcasts `clone_succeeded`.
- On any error (network, auth, dest-exists): marks `failed`, broadcasts `clone_failed`.

Worker timeout = `Config.hook_timeout_ms() * 5` (default 5 min). Configurable via `templates.clone_timeout_ms` in YAML.

### 5.4 Slice B integration

`Templates.instantiate_template/2` accepts a `tracker` payload in its attrs (same shape as Slice B's `POST /projects/workspace`). The boundary forwards the tracker to `Context.create_workspace_project/1`.

```elixir
def instantiate_template(slug, attrs) do
  with {:ok, template}   <- get_template(slug),
       resolved_attrs    <- substitute_placeholders(template, attrs),
       merged_project    <- merge_template_into_attrs(template, resolved_attrs),
       {:ok, project}    <- Context.create_workspace_project(merged_project),
       :ok               <- enqueue_clone_jobs(project, resolved_attrs.repositories) do
    {:ok, project}
  end
end
```

`merge_template_into_attrs/2` skips `workflow_statuses` when `attrs.tracker.kind != "local"` (Slice B remote projects get statuses from the remote).

## 6. Backend design

### 6.1 Migration

`priv/repo/migrations/2026MMDDHHMMSS_create_workspace_templates.exs`

```elixir
def change do
  create table(:local_tracker_workspace_templates) do
    add :name, :string, null: false
    add :slug, :string, null: false
    add :description, :string
    add :workflow_statuses, :map, null: false, default: %{}
    add :validation_commands, :map, null: false, default: %{}
    add :after_create_hook, :text
    add :before_run_hook, :text
    add :after_run_hook, :text
    add :before_remove_hook, :text
    add :prompt_template, :text
    add :dev_env_markdown, :text
    add :metadata, :map, null: false, default: %{}
    timestamps(type: :utc_datetime_usec)
  end
  create unique_index(:local_tracker_workspace_templates, [:slug])

  create table(:local_tracker_workspace_template_repositories) do
    add :template_id, references(:local_tracker_workspace_templates, on_delete: :delete_all), null: false
    add :github_full_name, :string, null: false
    add :clone_url, :string, null: false
    add :default_branch, :string
    add :workspace_path, :string, null: false
    add :role, :string
    timestamps(type: :utc_datetime_usec)
  end
  create index(:local_tracker_workspace_template_repositories, [:template_id])

  create table(:local_tracker_clone_jobs) do
    add :project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false
    add :repository_id, references(:local_tracker_repositories, on_delete: :delete_all), null: false
    add :status, :string, null: false, default: "pending"
    add :error, :text
    add :started_at, :utc_datetime_usec
    add :completed_at, :utc_datetime_usec
    add :commit_sha, :string
    timestamps(type: :utc_datetime_usec)
  end
  create unique_index(:local_tracker_clone_jobs, [:project_id, :repository_id])
end
```

Note: SQLite stores `:map` as JSON text. The `workflow_statuses` and `validation_commands` fields use `{:array, :map}` / `{:array, :string}` in the schema and round-trip via `Ecto.Type` casting to/from JSON.

### 6.2 Save-as-template

```elixir
def save_project_as_template(project_slug, overrides) do
  with {:ok, project}        <- Context.get_project(project_slug),
       repositories          <- Context.list_repositories(project_slug),
       setup                 <- Context.get_project_setup(project_slug),
       statuses              <- Context.list_statuses(project_slug) do
    attrs = %{
      name:                 overrides[:name] || "#{project.name} (template)",
      slug:                 overrides[:slug] || "#{project.slug}-template",
      description:          overrides[:description] || project.description,
      workflow_statuses:    Enum.map(statuses, &normalize_status/1),
      validation_commands:  validation_commands_from_setup(setup),
      after_create_hook:    setup && parameterize_hook(setup.after_create_hook, project),
      prompt_template:      setup && setup.prompt_template,
      dev_env_markdown:     overrides[:dev_env_markdown],
      metadata:             %{source: "saved_from_project", source_project_slug: project_slug},
      repositories:         Enum.map(repositories, &repository_to_template_attrs(&1, project))
    }
    create_template(attrs)
  end
end
```

`parameterize_hook/2` walks the hook string and replaces literal `project.slug` occurrences with `{{slug}}`. Same for `parameterize_repo_url/2` which replaces the literal owner with `{{owner}}` only if the user opts in (off by default — most users want literal owners).

### 6.3 Instantiate from template

```elixir
def instantiate_template(template_slug, attrs) do
  Repo.transact(fn ->
    with {:ok, template}  <- get_template(template_slug),
         {:ok, resolved}  <- substitute(template, attrs),
         {:ok, project}   <- Context.create_workspace_project(merge(template, resolved)),
         {:ok, _jobs}     <- enqueue_clone_jobs(project, resolved.repositories) do
      Broadcaster.template_applied(template, project)
      {:ok, project}
    end
  end)
end
```

### 6.4 Clone job lifecycle

```
[pending] --start_link--> [running] --git clone--> [succeeded] or [failed]
                                                            \--> [skipped] (already cloned)
```

Channel `templates:<project_slug>` broadcasts events:

```json
// clone_started
{"event":"clone_started","repository_id":"42","github_full_name":"acme/api"}

// clone_progress (optional: parsed from git progress output; best-effort)
{"event":"clone_progress","repository_id":"42","percent":35}

// clone_succeeded
{"event":"clone_succeeded","repository_id":"42","commit_sha":"a1b2c3d","duration_ms":4823}

// clone_failed
{"event":"clone_failed","repository_id":"42","error":"authentication required"}

// clone_skipped
{"event":"clone_skipped","repository_id":"42","reason":"destination already a clone of acme/api"}
```

Progress percent is best-effort — git's stderr stream is parsed for `Receiving objects: NN%`. If parsing fails, no `clone_progress` events are emitted; the UI falls back to "Cloning…" spinner.

### 6.5 Substitution

`substitute/2` walks the template and replaces:

- `{{slug}}` → `attrs.slug`
- `{{name}}` → `attrs.name`
- `{{workspace_root}}` → `Config.workspace_root()`

…in: `clone_url`, `workspace_path`, `after_create_hook`, `before_run_hook`, `after_run_hook`, `before_remove_hook`, `prompt_template`, `dev_env_markdown`.

Implementation: a single regex `~r/\{\{\s*(slug|name|workspace_root)\s*\}\}/` to keep behavior tightly scoped. Unknown tokens stay literal — no error (to keep YAML imports forgiving).

### 6.6 Routes

```
get    /api/tracker/v1/templates                  → Templates.list
post   /api/tracker/v1/templates                  → Templates.create
get    /api/tracker/v1/templates/:slug            → Templates.show
patch  /api/tracker/v1/templates/:slug            → Templates.update
delete /api/tracker/v1/templates/:slug            → Templates.delete
post   /api/tracker/v1/templates/:slug/instantiate→ Templates.instantiate
post   /api/tracker/v1/templates/import           → Templates.import_yaml
get    /api/tracker/v1/templates/:slug/export     → Templates.export_yaml
post   /api/tracker/v1/projects/:slug/save_as_template
                                                 → Templates.save_project_as_template
get    /api/tracker/v1/projects/:slug/clone_jobs → CloneJob.list_for_project
```

All under `pipe_through(:tracker_api)` (bearer auth, JSON).

### 6.7 YAML schema

```yaml
slug: gamba-workspace
name: Gamba Workspace
description: Multi-repo workspace for the Gamba product (goapi + frontend + backend).
workflow_statuses:
  - {name: Backlog,      category: backlog,  position: 0, is_terminal: false}
  - {name: Todo,         category: active,   position: 1, is_terminal: false}
  - {name: In Progress,  category: active,   position: 2, is_terminal: false}
  - {name: Done,         category: terminal, position: 3, is_terminal: true}
validation_commands:
  - mix test
  - pnpm test
after_create_hook: |
  cd {{workspace_root}}/{{slug}}/goapi  && go mod download
  cd {{workspace_root}}/{{slug}}/web   && pnpm install
prompt_template: |
  You are working on the Gamba workspace. Repositories:
  - backend: gamba/goapi at `goapi/`
  - frontend: gamba/web at `web/`
dev_env_markdown: |
  ## Local environment
  1. Run `docker compose up -d` to start postgres.
  ...
repositories:
  - github_full_name: gamba/goapi
    clone_url: https://github.com/gamba/goapi.git
    default_branch: main
    workspace_path: goapi
    role: backend
  - github_full_name: gamba/web
    clone_url: https://github.com/gamba/web.git
    default_branch: main
    workspace_path: web
    role: frontend
metadata:
  source: imported
```

YAML loader uses `YamlElixir` (already a dep). Unknown keys at the top level cause a `:invalid_yaml` error with the offending key path; unknown keys inside `repositories[*]` are ignored to allow forward compat.

## 7. Frontend design

### 7.1 Wizard "Start from a template" tab

`ProjectWorkspaceWizard.tsx` gets a tab toggle at the top of the dialog:

```
[ Start from a template ]  [ Build from scratch ]
```

- **Start from a template** (new): a searchable list of templates loaded via `listTemplates()`. Cards show name + repo count + description. Selecting one reveals an inline preview (repos, hooks). Submit: requires `name`, `slug`. Optional: dev-env Markdown editor.
- **Build from scratch**: the current wizard (GitHub org browser + repo scan + suggest).

The template tab is the **default** when at least one template exists; otherwise the build-from-scratch tab is preselected.

### 7.2 New routes/pages

- `/templates` — list view with create/import/delete actions.
- `/templates/:slug` — edit form with name, description, workflow statuses editor, repos editor, hooks editor (multiline + token hints), prompt template editor, dev-env Markdown editor. Save / Delete / Export YAML / Duplicate buttons.

Both pages reuse `ProjectSidebar` / `ProjectHeader` for consistency. A new `Templates` link is added to the sidebar (above the Projects list).

### 7.3 New components

- `tracker/src/components/templates/TemplateList.tsx`
- `tracker/src/components/templates/TemplateCard.tsx`
- `tracker/src/components/templates/TemplateForm.tsx`
- `tracker/src/components/templates/TemplateImportButton.tsx`
- `tracker/src/components/templates/CloneProgressBar.tsx`
- `tracker/src/components/templates/SaveAsTemplateDialog.tsx`

### 7.4 Service layer

`tracker/src/services/templates.ts`:

```ts
export async function listTemplates(): Promise<WorkspaceTemplate[]>;
export async function getTemplate(slug: string): Promise<WorkspaceTemplate>;
export async function createTemplate(input: CreateTemplateInput): Promise<WorkspaceTemplate>;
export async function updateTemplate(slug: string, input: UpdateTemplateInput): Promise<WorkspaceTemplate>;
export async function deleteTemplate(slug: string): Promise<void>;
export async function importTemplate(yaml: string): Promise<WorkspaceTemplate>;
export async function exportTemplate(slug: string): Promise<string>;
export async function instantiateTemplate(slug: string, input: InstantiateTemplateInput): Promise<Project>;
export async function saveProjectAsTemplate(projectSlug: string, input: SaveAsTemplateInput): Promise<WorkspaceTemplate>;
export async function listCloneJobs(projectSlug: string): Promise<CloneJob[]>;
```

### 7.5 Realtime clone progress

A new hook `useCloneProgress(projectSlug)` subscribes to the `templates:<project_slug>` Channel and exposes:

```ts
interface CloneState {
  jobs: Record<string, CloneJob>;     // keyed by repository_id
  allSucceeded: boolean;
  anyFailed: boolean;
  inProgressCount: number;
}
```

The board page (Slice A/B) renders a `CloneProgressBar` banner at the top while `anyFailed === true || allSucceeded === false`. Users can retry failed clones with a Retry button (calls `POST /projects/:slug/clone_jobs/:job_id/retry` — new endpoint).

### 7.6 "Save as template" button

On the project header (`ProjectHeader.tsx`), a new overflow-menu item "Save as template" opens `SaveAsTemplateDialog`. Fields: name, slug, description. Submit calls `saveProjectAsTemplate(...)` and routes the user to `/templates/<new-slug>` for refinement.

### 7.7 Built-in templates

On first run, the backend imports `priv/templates/single-repo-elixir.yml` and `priv/templates/multi-repo-fullstack.yml` if no rows exist with those slugs. Users can delete them; they will not be re-imported unless the DB is wiped.

## 8. Migration & backward compatibility

- Pure additive: no changes to `Project`, `Repository`, or `ProjectSetup` schemas.
- The Wizard still works exactly as today; the new template tab is opt-in.
- Slice B's per-project tracker_kind is independent. A template applied to a project that uses a remote tracker simply skips the workflow_statuses import; everything else (repos, hooks) applies.
- Existing projects can be "Saved as template" at any time without modifying their data.

## 9. Error handling

| Error | HTTP | code | message |
|---|---|---|---|
| template slug not found | 404 | `template_not_found` | |
| invalid YAML on import | 422 | `template_yaml_invalid` | with `details.line` |
| duplicate slug on create/import | 422 | `template_slug_taken` | |
| substitution result fails project changeset | 422 | `template_apply_failed` | with `details: changeset_errors` |
| clone destination not empty / different remote | per-repo job → `clone_destination_exists` | n/a (broadcast) | |
| missing `GITHUB_TOKEN` for private repo clone | per-repo job → `clone_unauthorized` | n/a (broadcast) | |
| git binary missing on server | per-repo job → `git_unavailable` | n/a (broadcast) | |
| network timeout (> clone_timeout_ms) | per-repo job → `clone_timeout` | n/a (broadcast) | |

All clone errors are sticky on the `CloneJob` row; the UI surfaces them with Retry / Open path / Copy clone URL actions.

## 10. Testing strategy

### 10.1 Backend (ExUnit)

- `SymphonyElixir.LocalTracker.WorkspaceTemplateTest` — schema validations (slug uniqueness, required fields, repos require workspace_path and clone_url).
- `SymphonyElixir.LocalTracker.TemplatesTest`
  - `create_template/1` happy path
  - `list_templates/0` ordering by inserted_at desc
  - `import_yaml/1` round-trip (`export_yaml` → `import_yaml` returns an identical template)
  - `save_project_as_template/2` captures repos and parameterizes the slug
  - `instantiate_template/2`:
    - creates Project + Repositories + ProjectSetup
    - substitutes `{{slug}}` in clone_url and workspace_path
    - enqueues N CloneJobs (one per repo)
    - skips workflow_statuses when `tracker.kind = "github"`
- `SymphonyElixir.LocalTracker.CloneWorkerTest` — mock `System.cmd` via `Application.put_env(:symphony_elixir, :clone_command_module, MockCloneCommand)`:
  - happy path → `:succeeded` + commit_sha set
  - existing valid repo → `:skipped`
  - existing non-repo dir → `:failed` with `clone_destination_exists`
  - non-zero git exit → `:failed` with stderr captured
  - timeout → `:failed` with `clone_timeout`
- Controller tests for all 9 routes in §6.6.
- Channel test for `templates:<slug>` broadcasts.

### 10.2 Frontend (Vitest + RTL)

- `tracker/src/services/__tests__/templates.test.ts` — every service method's axios payload.
- `tracker/src/components/templates/__tests__/TemplateForm.test.tsx` — form rendering + submit.
- `tracker/src/components/templates/__tests__/TemplateImportButton.test.tsx` — drag-and-drop YAML upload.
- `tracker/src/components/templates/__tests__/SaveAsTemplateDialog.test.tsx`.
- `tracker/src/components/templates/__tests__/CloneProgressBar.test.tsx` — handles all 5 event types + retry.
- `tracker/src/hooks/__tests__/useCloneProgress.test.tsx` — channel subscription mock.
- `tracker/src/components/projects/__tests__/ProjectWorkspaceWizard.test.tsx` — extends existing test for the new tab + template-driven submit path.

### 10.3 End-to-end smoke (manual)

1. Create a project from scratch (existing flow still works).
2. "Save as template" on it → edit template → ensure `{{slug}}` placeholders look right.
3. Create a new project from that template → confirm repos clone in background, progress bar appears, all reach succeeded.
4. Disconnect network mid-clone → see `clone_failed`; reconnect → Retry succeeds.
5. Export template → re-import on another machine → confirm round-trip.
6. Apply a template with `tracker.kind = "github"` (Slice B) → workflow_statuses ignored; repos still cloned.

## 11. Open questions / future work

- **Template versioning** (snapshots + ability to upgrade an existing project to a newer version).
- **Per-template secrets / env scaffolding** (e.g., write a `.env.example` post-clone).
- **Submodule / monorepo handling** (today we treat each repo as a top-level clone).
- **Worktrees vs. clones.** For users who prefer `git worktree`, an alternative `clone_strategy: worktree` could be added later.
- **Marketplace / shared registry.**
- **Re-applying a template** to add new repos to an existing project.
- **Variable expansion beyond the three tokens** (e.g., `{{date}}`, `{{user.login}}`).

## 12. Success criteria

A reviewer should be able to:

1. Run migrations and see new tables with no impact on existing data.
2. Save an existing project as a template and instantiate a new project from it; see all repos cloned into `Config.workspace_root()/<slug>/`.
3. Export a template as YAML, import it on a different machine, and instantiate a project successfully.
4. Apply a template to a project that uses `tracker_kind = "github"` (Slice B) — repos cloned, statuses come from remote.
5. Disconnect the network during a clone and successfully retry from the UI.
6. Run the full `mix test` + `pnpm test` suite green.
