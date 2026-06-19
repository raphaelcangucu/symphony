# Project Dev-Env Warm-up Implementation Plan

**Goal:** Add a one-time, project-level "Preparar ambiente" warm-up that proves a freshly-configured project boots healthy for a standardized default tenant (pull images, ECR login, resolve Docker conflicts, dry-run boot → `/health` → teardown), driven by a deterministic assistant tool inside a project chat session, with readiness state + a proactive banner.

**Architecture:** Reuse the existing `DevEnv` run engine + `.symphony/` scripts + project Assistant. A new assistant-only `manage_dev_env` action `warm_up` calls `DevEnv.warm_up/2`, which runs the `.symphony/` setup + a `SYMPHONY_WARMUP=1` serve dry-run as a **blocking shell exec** (capturing exit code/output), classifies failures, records a `DevEnv.Run` of `kind: "warm_up"`, and updates project readiness fields. The UI shows a banner that seeds the project Assistant composer with a bootstrap prompt (reusing the existing composer-handoff pattern) so the agent runs the tool and, on failure, fixes things in the same thread.

**Tech Stack:** Elixir/Phoenix + Ecto (backend), Bash (`.symphony/` scripts), React + TypeScript + Vitest (tracker frontend), ExUnit (backend tests).

---

## Scope & decomposition

This plan covers three **independently shippable** phases. Each ends green and committable on its own:

- **Phase A — `.symphony/` scripts** (warm-up mode + default-tenant authoritative health). Testable standalone in the `advising` repo + the canonical template.
- **Phase B — Backend** (`DevEnv.warm_up/2`, `manage_dev_env` `warm_up` action, readiness state + API). Pure Elixir.
- **Phase C — Tracker UI** (readiness banner, composer-handoff seed, `DevEnvPanel` last-run).

> **Two implementation refinements vs. the spec** (`docs/superpowers/specs/2026-06-19-project-dev-env-warmup-design.md`), both realize the approved decisions with less surface:
> 1. `DevEnv.warm_up/2` executes the dry-run as a **blocking `System.cmd`** (the tmux `Runner.run_step` does not capture exit codes — see `dev_env/runner.ex`).
> 2. "Open the chat session with a prompt" **reuses the existing composer-handoff** (`tracker/src/lib/previewAssistantHandoff.ts`) generalized to project scope, instead of a new backend thread-bootstrap endpoint (spec §6). Same D1 outcome, fewer moving parts.

## File structure

**Phase A (target repo `~/code/advising-workspaces/advising/CDE-1139/advising`, mirrored into the canonical template):**
- Modify: `.symphony/serve.sh` — honor `SYMPHONY_WARMUP=1` (boot → health → teardown → exit 0).
- Modify: `.symphony/common.sh` — `PREVIEW_TENANT` default + authoritative tenant health (no silent bare-localhost fallback when a tenant is set).

**Phase B (`/home/raphaelcangucu/symphony`):**
- Create: `elixir/priv/repo/migrations/20260619120000_add_dev_env_warm_up.exs`
- Modify: `elixir/lib/symphony_elixir/local_tracker/dev_env/run.ex` — add `kind`.
- Modify: `elixir/lib/symphony_elixir/local_tracker/dev_env.ex` — `start_run/2` (kind), `warm_up/2`, `warm_up_state/1`.
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex` — `update_warm_up_state/2`.
- Modify: `elixir/lib/symphony_elixir/assistant/dev_env_tools.ex` — `:warm_up` action (assistant-only).
- Modify: `elixir/lib/symphony_elixir_web/tracker_presenter.ex` — expose readiness on the project DTO.
- Tests: `elixir/test/symphony_elixir/local_tracker/dev_env/warm_up_test.exs`, `elixir/test/symphony_elixir/assistant/dev_env_tools_test.exs` (extend).

**Phase C (`/home/raphaelcangucu/symphony/tracker`):**
- Modify: `tracker/src/types/project.ts` — readiness fields.
- Modify: `tracker/src/services/projects.ts` + `tracker/src/services/mappers.ts` — map readiness.
- Modify: `tracker/src/lib/previewAssistantHandoff.ts` — project-scope seed (or new `tracker/src/lib/devEnvWarmupHandoff.ts`).
- Create: `tracker/src/components/devenv/WarmUpBanner.tsx` + test.
- Modify: `tracker/src/components/devenv/DevEnvPanel.tsx` — last warm-up + re-run.

---

# Phase A — `.symphony/` scripts

> Run all Phase A commands from the advising checkout:
> `cd ~/code/advising-workspaces/advising/CDE-1139/advising`

### Task A1: `serve.sh` warm-up mode (boot → health → teardown → exit 0)

**Files:**
- Modify: `.symphony/serve.sh`

- [ ] **Step 1: Write the failing check**

Append a focused self-check at `.symphony/__warmup_check.sh` (temporary, deleted in Step 5):

```bash
#!/usr/bin/env bash
# Asserts serve.sh honors SYMPHONY_WARMUP by tearing down after health.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
grep -q 'SYMPHONY_WARMUP' .symphony/serve.sh || { echo "FAIL: serve.sh does not reference SYMPHONY_WARMUP"; exit 1; }
# In warmup mode the script must NOT fall through to the blocking 'docker logs -f ... wait' tail.
awk '/SYMPHONY_WARMUP/{seen=1} END{exit seen?0:1}' .symphony/serve.sh
echo "OK: serve.sh warmup hook present"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash .symphony/__warmup_check.sh`
Expected: `FAIL: serve.sh does not reference SYMPHONY_WARMUP` (exit 1).

- [ ] **Step 3: Implement warm-up mode in `serve.sh`**

In `.symphony/serve.sh`, replace the final foreground tail block:

```bash
# Stay in the foreground, streaming app logs, until Symphony stops us.
log "Following inspire logs (Ctrl-C / stop to tear down)…"
docker logs -f "$(inspire_container)" &
LOG_PID=$!
wait "$LOG_PID"
```

with a warm-up branch that tears down instead of following logs:

```bash
# Warm-up mode (project-level dry-run): we only wanted to prove the stack boots
# healthy. Tear the app down (keep images cached + shared singletons) and exit 0
# so the caller records a successful warm-up instead of blocking on logs forever.
if [ "${SYMPHONY_WARMUP:-0}" = "1" ]; then
    ok "Warm-up dry-run healthy — tearing the app down (images stay cached)"
    ( cd "$REPO_ROOT" && COMPOSE_PROJECT_NAME="$PROJECT" ./vibe down >/dev/null 2>&1 ) || true
    exit 0
fi

# Normal serve: stay in the foreground, streaming app logs, until Symphony stops us.
log "Following inspire logs (Ctrl-C / stop to tear down)…"
docker logs -f "$(inspire_container)" &
LOG_PID=$!
wait "$LOG_PID"
```

- [ ] **Step 4: Run the check + bash syntax to verify pass**

Run: `bash -n .symphony/serve.sh && bash .symphony/__warmup_check.sh`
Expected: `OK: serve.sh warmup hook present` (exit 0).

- [ ] **Step 5: Remove the temp check and commit**

```bash
rm -f .symphony/__warmup_check.sh
git add .symphony/serve.sh
git commit -m "feat(symphony): serve.sh SYMPHONY_WARMUP mode tears down after health"
```

### Task A2: `common.sh` default tenant + authoritative health

**Files:**
- Modify: `.symphony/common.sh`

- [ ] **Step 1: Write the failing check**

Create `.symphony/__tenant_check.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
. .symphony/common.sh
# Default tenant must resolve to illume when nothing is set.
[ "$PREVIEW_TENANT" = "illume" ] || { echo "FAIL: default PREVIEW_TENANT='$PREVIEW_TENANT' (want illume)"; exit 1; }
# An explicit override must win.
( SYMPHONY_PREVIEW_TENANT=utsa bash -c '. .symphony/common.sh; [ "$PREVIEW_TENANT" = "utsa" ]' ) \
  || { echo "FAIL: SYMPHONY_PREVIEW_TENANT override ignored"; exit 1; }
echo "OK: tenant defaults resolve"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash .symphony/__tenant_check.sh`
Expected: `FAIL: default PREVIEW_TENANT='' (want illume)` (the current default is empty).

- [ ] **Step 3: Implement default tenant + authoritative probe**

In `.symphony/common.sh`, change the tenant default line:

```bash
PREVIEW_TENANT="${SYMPHONY_PREVIEW_TENANT:-}"
```

to a configurable default (illume):

```bash
# Default preview tenant. Multi-tenant apps (Inspire) serve /health per-tenant
# vhost (Host: <tenant>.localhost). "illume" is the standard demo/sandbox tenant.
# Per-task overrides come via SYMPHONY_PREVIEW_TENANT (set only for tenant-specific work).
PREVIEW_TENANT="${SYMPHONY_PREVIEW_TENANT:-${SYMPHONY_DEFAULT_TENANT:-illume}}"
```

Then make `check_backend_health` authoritative when a tenant is set — replace the host candidate list build:

```bash
    local hosts=() h url code body
    [ -n "$PREVIEW_TENANT" ] && hosts+=("$PREVIEW_TENANT.localhost")
    hosts+=("")  # bare localhost / default vhost
```

with:

```bash
    local hosts=() h url code body
    if [ -n "$PREVIEW_TENANT" ]; then
        # Tenant set → probe ONLY that vhost. A bare-localhost fallback would hit
        # the first vhost (e.g. kiosk) and mask a broken tenant, so we don't add it.
        hosts+=("$PREVIEW_TENANT.localhost")
    else
        hosts+=("")  # no tenant configured → bare localhost / default vhost
    fi
```

- [ ] **Step 4: Run the check to verify pass**

Run: `bash -n .symphony/common.sh && bash .symphony/__tenant_check.sh`
Expected: `OK: tenant defaults resolve` (exit 0).

- [ ] **Step 5: Remove temp check and commit**

```bash
rm -f .symphony/__tenant_check.sh
git add .symphony/common.sh
git commit -m "feat(symphony): default preview tenant=illume + authoritative tenant health probe"
```

### Task A3: End-to-end warm-up smoke (manual gate, no commit)

- [ ] **Step 1: Run a real warm-up dry-run**

Run:
```bash
INSPIRE_PORT=4399 SYMPHONY_WARMUP=1 bash -lc \
  'export PATH="$PWD/node_modules/.bin:$PATH" && bash .symphony/setup.sh && bash .symphony/serve.sh'
```
Expected: ECR login via profile, stack boots, `Preview is healthy: http://localhost:4399/health` for `Host: illume.localhost`, then `Warm-up dry-run healthy — tearing the app down`, exit 0.

- [ ] **Step 2: Confirm teardown**

Run: `docker ps --filter "name=cde-1139-inspire-1" --format '{{.Names}}'`
Expected: empty (the warm-up app project was torn down).

> Phase A is shippable here. Mirror the two diffs into the canonical template that Phase B/`needs_scaffold` ships (tracked as a follow-up; same edits).

---

# Phase B — Backend (`/home/raphaelcangucu/symphony`)

> Run all Phase B commands from `elixir/`: `cd /home/raphaelcangucu/symphony/elixir`

### Task B1: Migration — `kind` on runs + readiness on projects

**Files:**
- Create: `elixir/priv/repo/migrations/20260619120000_add_dev_env_warm_up.exs`

- [ ] **Step 1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddDevEnvWarmUp do
  use Ecto.Migration

  def change do
    alter table(:local_tracker_dev_env_runs) do
      add(:kind, :string, null: false, default: "run")
    end

    alter table(:local_tracker_projects) do
      add(:warmed_at, :utc_datetime_usec)
      add(:warm_up_status, :string, null: false, default: "never")
      add(:last_warm_up_run_id, :integer)
    end
  end
end
```

- [ ] **Step 2: Run the migration**

Run: `mix ecto.migrate`
Expected: migrates `...AddDevEnvWarmUp` with no errors.

- [ ] **Step 3: Commit**

```bash
git add priv/repo/migrations/20260619120000_add_dev_env_warm_up.exs
git commit -m "feat(dev_env): migration for warm-up run kind + project readiness"
```

### Task B2: `Run.kind` + `start_run/2` + `Context.update_warm_up_state/2`

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/dev_env/run.ex`
- Modify: `elixir/lib/symphony_elixir/local_tracker/dev_env.ex:70-77`
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env/warm_up_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/local_tracker/dev_env/warm_up_test.exs`:

```elixir
defmodule SymphonyElixir.LocalTracker.DevEnv.WarmUpTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.LocalTracker.{Context, DevEnv}

  setup do
    {:ok, project} = Context.create_project(%{name: "Adv", slug: "adv"})
    %{project: project}
  end

  test "start_run records the run kind", %{project: project} do
    {:ok, run} = DevEnv.start_run(project.slug, "warm_up")
    assert run.kind == "warm_up"
  end

  test "update_warm_up_state persists readiness", %{project: project} do
    {:ok, run} = DevEnv.start_run(project.slug, "warm_up")
    {:ok, updated} = Context.update_warm_up_state(project.slug, %{status: "succeeded", run_id: run.id})
    assert updated.warm_up_status == "succeeded"
    assert updated.last_warm_up_run_id == run.id
    assert updated.warmed_at != nil
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `mix test test/symphony_elixir/local_tracker/dev_env/warm_up_test.exs`
Expected: FAIL — `start_run/2` undefined and `Context.update_warm_up_state/2` undefined.

- [ ] **Step 3a: Add `kind` to the `Run` schema**

In `run.ex`, add the field + kinds and cast:

```elixir
  @type t :: %__MODULE__{}
  @statuses ~w(pending running succeeded failed)
  @kinds ~w(run warm_up)

  schema "local_tracker_dev_env_runs" do
    field(:status, :string, default: "pending")
    field(:kind, :string, default: "run")
    field(:started_at, :utc_datetime_usec)
    field(:completed_at, :utc_datetime_usec)

    belongs_to(:project, Project)
    has_many(:step_runs, StepRun, foreign_key: :run_id, on_delete: :delete_all)
    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(run, attrs) do
    run
    |> cast(attrs, [:project_id, :status, :kind, :started_at, :completed_at])
    |> validate_required([:project_id, :status, :kind])
    |> validate_inclusion(:status, @statuses)
    |> validate_inclusion(:kind, @kinds)
  end
```

- [ ] **Step 3b: Make `start_run/2` accept a kind**

In `dev_env.ex`, replace `start_run/1` (lines 70-77):

```elixir
  @spec start_run(String.t(), String.t()) :: {:ok, Run.t()} | {:error, error()}
  def start_run(project_slug, kind \\ "run") do
    with {:ok, project} <- Context.get_project(project_slug) do
      %Run{}
      |> Run.changeset(%{project_id: project.id, kind: kind, status: "running", started_at: now()})
      |> Repo.insert()
    end
  end
```

- [ ] **Step 3c: Add `Context.update_warm_up_state/2`**

In `context.ex`, after `update_project/2` (around line 134), add:

```elixir
  @spec update_warm_up_state(String.t(), map()) :: {:ok, Project.t()} | {:error, missing_error()}
  def update_warm_up_state(project_slug, %{status: status} = attrs) when is_binary(project_slug) do
    with {:ok, project} <- fetch_project(project_slug) do
      changes = %{
        warm_up_status: status,
        last_warm_up_run_id: Map.get(attrs, :run_id, project.last_warm_up_run_id),
        warmed_at: if(status == "succeeded", do: DateTime.utc_now(), else: project.warmed_at)
      }

      project
      |> Ecto.Changeset.change(changes)
      |> Repo.update()
    end
  end
```

- [ ] **Step 3d: Add readiness fields to the `Project` schema**

In `project.ex`, inside `schema "local_tracker_projects"`, add (after `tracker_config`):

```elixir
    field(:warmed_at, :utc_datetime_usec)
    field(:warm_up_status, :string, default: "never")
    field(:last_warm_up_run_id, :integer)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `mix test test/symphony_elixir/local_tracker/dev_env/warm_up_test.exs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/local_tracker/dev_env/run.ex lib/symphony_elixir/local_tracker/dev_env.ex lib/symphony_elixir/local_tracker/project.ex lib/symphony_elixir/local_tracker/context.ex test/symphony_elixir/local_tracker/dev_env/warm_up_test.exs
git commit -m "feat(dev_env): run kind + project warm-up readiness state"
```

### Task B3: `DevEnv.warm_up/2` (blocking exec + failure classification)

**Files:**
- Modify: `elixir/lib/symphony_elixir/local_tracker/dev_env.ex`
- Test: `elixir/test/symphony_elixir/local_tracker/dev_env/warm_up_test.exs`

- [ ] **Step 1: Write the failing tests**

Append to `warm_up_test.exs`:

```elixir
  describe "warm_up/2" do
    test "succeeds when the dry-run exits 0", %{project: project} do
      File.mkdir_p!(Path.join([base(project), ".symphony"]))
      File.write!(Path.join([base(project), ".symphony", "serve.sh"]), "#!/usr/bin/env bash\n")

      exec = fn _dir, _cmd, _opts -> {"booted; Preview is healthy", 0} end
      {:ok, result} = DevEnv.warm_up(project.slug, exec: exec)

      assert result.status == "succeeded"
      assert result.failure_class == nil
      assert Context.get_project(project.slug) |> elem(1) |> Map.get(:warm_up_status) == "succeeded"
    end

    test "classifies an ECR 403 as image_pull_auth", %{project: project} do
      File.mkdir_p!(Path.join([base(project), ".symphony"]))
      File.write!(Path.join([base(project), ".symphony", "serve.sh"]), "#!/usr/bin/env bash\n")

      exec = fn _dir, _cmd, _opts -> {"pull access denied: 403 Forbidden", 1} end
      {:ok, result} = DevEnv.warm_up(project.slug, exec: exec)

      assert result.status == "failed"
      assert result.failure_class == "image_pull_auth"
    end

    test "reports needs_scaffold when .symphony/serve.sh is missing", %{project: project} do
      {:ok, result} = DevEnv.warm_up(project.slug, exec: fn _, _, _ -> {"", 0} end)
      assert result.failure_class == "needs_scaffold"
      assert result.status == "failed"
    end
  end

  defp base(project), do: Path.join(SymphonyElixir.Config.workspace_root(), project.slug)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `mix test test/symphony_elixir/local_tracker/dev_env/warm_up_test.exs`
Expected: FAIL — `DevEnv.warm_up/2` undefined.

- [ ] **Step 3: Implement `warm_up/2`**

In `dev_env.ex`, add (and ensure `alias SymphonyElixir.Config` is already aliased — it is, used by `workspace_root/1`):

```elixir
  @doc """
  One-time, project-level dev-env warm-up: run .symphony setup + a SYMPHONY_WARMUP
  serve dry-run (boot → /health → teardown) as a blocking shell exec, classify any
  failure, record a `warm_up` run, and update project readiness.
  """
  @spec warm_up(String.t(), keyword()) :: {:ok, map()} | {:error, error()}
  def warm_up(project_slug, opts \\ []) do
    exec = Keyword.get(opts, :exec, &default_warm_up_exec/3)
    tenant = Keyword.get(opts, :tenant, "illume")

    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, run} <- start_run(project_slug, "warm_up") do
      base = workspace_root(project_slug)

      if File.exists?(Path.join([base, ".symphony", "serve.sh"])) do
        port = Keyword.get(opts, :port, pick_ephemeral_port())
        {output, status} = exec.(base, warm_up_command(port, tenant), [])
        run_status = if status == 0, do: "succeeded", else: "failed"
        failure = if status == 0, do: nil, else: classify_warm_up_failure(output)
        finalize_warm_up(project_slug, run, run_status, failure, port, output)
      else
        finalize_warm_up(project_slug, run, "failed", "needs_scaffold", nil, "Missing .symphony/serve.sh")
      end
    end
  end

  defp warm_up_command(port, tenant) do
    "export PATH=\"$PWD/node_modules/.bin:$PATH\" && " <>
      "INSPIRE_PORT=#{port} SYMPHONY_WARMUP=1 SYMPHONY_PREVIEW_TENANT=#{tenant} " <>
      "bash .symphony/setup.sh && " <>
      "INSPIRE_PORT=#{port} SYMPHONY_WARMUP=1 SYMPHONY_PREVIEW_TENANT=#{tenant} bash .symphony/serve.sh"
  end

  defp default_warm_up_exec(base, command, _opts) do
    {output, status} = System.cmd("bash", ["-lc", command], cd: base, stderr_to_stdout: true)
    {output, status}
  rescue
    error -> {Exception.message(error), 1}
  end

  defp classify_warm_up_failure(output) do
    cond do
      output =~ ~r/403 Forbidden|pull access denied|not authorized|no basic auth/i -> "image_pull_auth"
      output =~ ~r/already in use by container/i -> "container_name_conflict"
      output =~ ~r/port is already allocated|address already in use/i -> "port_allocation"
      output =~ ~r/No such file or directory.*\.symphony|\.symphony.*No such file/i -> "needs_scaffold"
      output =~ ~r/Health was not confirmed|not running after/i -> "health_timeout"
      true -> "unknown"
    end
  end

  defp finalize_warm_up(project_slug, run, status, failure, port, output) do
    record_step_result(run, warm_up_step(run), %{
      status: status,
      output: String.slice(output || "", 0, 20_000)
    })

    {:ok, _finished} = finish_run(run)
    {:ok, _project} = Context.update_warm_up_state(project_slug, %{status: status, run_id: run.id})

    {:ok,
     %{
       run_id: run.id,
       status: status,
       failure_class: failure,
       port: port,
       output: output
     }}
  end

  # record_step_result requires a %Step{}; warm-up has no persisted step, so use a
  # transient struct carrying just the description/command for the StepRun record.
  defp warm_up_step(_run) do
    %Step{id: nil, description: "warm-up dry-run", command: "bash .symphony/serve.sh (SYMPHONY_WARMUP=1)"}
  end

  defp pick_ephemeral_port do
    {:ok, socket} = :gen_tcp.listen(0, [:binary, ip: {127, 0, 0, 1}])
    {:ok, port} = :inet.port(socket)
    :gen_tcp.close(socket)
    port
  end
```

> Note: `record_step_result/3` casts `:step_id`; passing a `%Step{id: nil}` yields a `nil` step_id (allowed — `StepRun` only requires `run_id`/`description`/`command`/`status`). Confirm `Step` is aliased in `dev_env.ex` (it is, via `alias ...DevEnv.{ProposedStep, Proposer, Run, Step, StepRun}`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `mix test test/symphony_elixir/local_tracker/dev_env/warm_up_test.exs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/local_tracker/dev_env.ex test/symphony_elixir/local_tracker/dev_env/warm_up_test.exs
git commit -m "feat(dev_env): DevEnv.warm_up/2 blocking dry-run with failure classification"
```

### Task B4: `manage_dev_env` `warm_up` action (assistant-only)

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/dev_env_tools.ex`
- Test: `elixir/test/symphony_elixir/assistant/dev_env_tools_test.exs`

- [ ] **Step 1: Write the failing tests**

Append to `dev_env_tools_test.exs`:

```elixir
  describe "warm_up action" do
    test "assistant can run warm_up via injected fun" do
      warm = fn _slug, _opts -> {:ok, %{run_id: 1, status: "succeeded", failure_class: nil, port: 4399, output: "ok"}} end

      {:ok, result} =
        DevEnvTools.execute("proj", %{"action" => "warm_up"}, warm_up: warm)

      assert result.tool == "manage_dev_env"
      assert result.data.status == "succeeded"
    end

    test "coding agents are denied warm_up" do
      assert {:error, :action_not_allowed} =
               DevEnvTools.execute("proj", %{"action" => "warm_up"}, coding_agent: true)
    end
  end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `mix test test/symphony_elixir/assistant/dev_env_tools_test.exs`
Expected: FAIL — `warm_up` is an `:invalid_dev_env_action`.

- [ ] **Step 3: Wire the action**

In `dev_env_tools.ex`:

Add `:warm_up` to assistant actions only (line 10):

```elixir
  @assistant_actions ~w(list_steps propose_steps save_steps run run_step list_runs warm_up)a
  @coding_agent_actions ~w(list_steps run run_step list_runs)a
```

Inject the warm-up fun (in `execute/3`, alongside the other `Keyword.get` defaults):

```elixir
    warm_up = Keyword.get(opts, :warm_up, &DevEnv.warm_up/2)
```

Pass it through `execute_action/…` (add a parameter) and add the clause:

```elixir
  defp execute_action(:warm_up, project_slug, _arguments, _propose, _list, _save, _runs, _start, _finish, _run_step, warm_up) do
    case warm_up.(project_slug, []) do
      {:ok, data} ->
        {:ok,
         %{
           tool: @tool,
           message: warm_up_message(data),
           data: data
         }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp warm_up_message(%{status: "succeeded"}), do: "Dev environment warm-up succeeded."
  defp warm_up_message(%{failure_class: class}), do: "Warm-up failed (#{class}). See data for remediation."
```

Add `warm_up` to `normalize_action/1`:

```elixir
      "warm_up" -> {:ok, :warm_up}
```

> The simplest wiring that avoids threading an 11th positional arg through every clause: in `execute/3`, special-case `:warm_up` before the generic dispatch:
> ```elixir
>     with {:ok, action} <- normalize_action(Map.get(arguments, "action")),
>          :ok <- authorize_action(action, opts) do
>       if action == :warm_up do
>         execute_warm_up(project_slug, warm_up)
>       else
>         execute_action(action, project_slug, arguments, propose_steps, list_steps, save_steps, list_runs, start_run, finish_run, run_step)
>       end
>     end
> ```
> with:
> ```elixir
>   defp execute_warm_up(project_slug, warm_up) do
>     case warm_up.(project_slug, []) do
>       {:ok, data} -> {:ok, %{tool: @tool, message: warm_up_message(data), data: data}}
>       {:error, reason} -> {:error, reason}
>     end
>   end
> ```
> Use this form (keeps the existing `execute_action/10` arity untouched).

Also add `warm_up` to the schema enum in `action_input_schema/2` automatically (it derives from `actions`, so no change needed) — confirm the assistant spec now lists `warm_up`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `mix test test/symphony_elixir/assistant/dev_env_tools_test.exs`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add lib/symphony_elixir/assistant/dev_env_tools.ex test/symphony_elixir/assistant/dev_env_tools_test.exs
git commit -m "feat(assistant): manage_dev_env warm_up action (assistant-only)"
```

### Task B5: Expose readiness on the project DTO

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/tracker_presenter.ex`
- Test: extend the presenter test (search `tracker_presenter` tests) or add a focused assertion.

- [ ] **Step 1: Find the project presenter shape**

Run: `rg -n "def project" lib/symphony_elixir_web/tracker_presenter.ex`
Expected: a `project/1` builder mapping a `%Project{}` to a map.

- [ ] **Step 2: Write the failing assertion**

In the existing presenter test file (path from Step 1's neighbors), add:

```elixir
  test "project/1 includes warm-up readiness" do
    project = %SymphonyElixir.LocalTracker.Project{slug: "p", name: "P", warm_up_status: "succeeded", last_warm_up_run_id: 7}
    dto = SymphonyElixirWeb.TrackerPresenter.project(project)
    assert dto.warm_up_status == "succeeded"
    assert dto.last_warm_up_run_id == 7
  end
```

- [ ] **Step 3: Run it to verify it fails**

Run: `mix test <presenter_test_path>`
Expected: FAIL — keys missing.

- [ ] **Step 4: Add the keys to `project/1`**

In `tracker_presenter.ex` `project/1`, add to the returned map:

```elixir
      warmed_at: project.warmed_at,
      warm_up_status: project.warm_up_status,
      last_warm_up_run_id: project.last_warm_up_run_id,
```

- [ ] **Step 5: Run + commit**

Run: `mix test <presenter_test_path>`
Expected: PASS

```bash
git add lib/symphony_elixir_web/tracker_presenter.ex <presenter_test_path>
git commit -m "feat(tracker-api): expose project warm-up readiness"
```

### Task B6: Full backend suite green

- [ ] **Step 1: Run the related suites**

Run: `mix test test/symphony_elixir/local_tracker/ test/symphony_elixir/assistant/`
Expected: PASS, no warnings about unused vars in the edited files.

---

# Phase C — Tracker UI (`/home/raphaelcangucu/symphony/tracker`)

> Run all Phase C commands from `tracker/`: `cd /home/raphaelcangucu/symphony/tracker`

### Task C1: Readiness on the project type + service mapping

**Files:**
- Modify: `tracker/src/types/project.ts`
- Modify: `tracker/src/services/mappers.ts` (project normalizer) and/or `tracker/src/services/projects.ts`
- Test: `tracker/src/services/__tests__/projects.test.ts`

- [ ] **Step 1: Find the project normalizer**

Run: `rg -n "warm_up_status|normalizeProject|warmUpStatus" src/services src/types`
Expected: a `normalizeProject` (mappers.ts) and a `Project` interface (types/project.ts) with no warm-up fields yet.

- [ ] **Step 2: Write the failing test**

In `src/services/__tests__/projects.test.ts`, add (adapt to the existing normalizer entry point):

```ts
it("maps warm-up readiness", () => {
  const dto = { slug: "p", name: "P", warm_up_status: "failed", warmed_at: null, last_warm_up_run_id: 3 };
  const project = normalizeProject(dto as never);
  expect(project.warmUpStatus).toBe("failed");
  expect(project.lastWarmUpRunId).toBe(3);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/services/__tests__/projects.test.ts`
Expected: FAIL — `warmUpStatus` undefined.

- [ ] **Step 4: Add the fields + mapping**

In `src/types/project.ts`, add to the `Project` interface:

```ts
  warmUpStatus: "never" | "running" | "succeeded" | "failed";
  warmedAt: string | null;
  lastWarmUpRunId: number | null;
```

In `src/services/mappers.ts` `normalizeProject`, add:

```ts
    warmUpStatus: (dto.warm_up_status ?? "never") as Project["warmUpStatus"],
    warmedAt: dto.warmed_at ?? null,
    lastWarmUpRunId: dto.last_warm_up_run_id ?? null,
```

(and add `warm_up_status?`, `warmed_at?`, `last_warm_up_run_id?` to the project DTO type in mappers.ts).

- [ ] **Step 5: Run + commit**

Run: `npx vitest run src/services/__tests__/projects.test.ts`
Expected: PASS

```bash
git add src/types/project.ts src/services/mappers.ts src/services/__tests__/projects.test.ts
git commit -m "feat(tracker): map project warm-up readiness"
```

### Task C2: Project-scope composer handoff (seed the bootstrap prompt)

**Files:**
- Modify: `tracker/src/lib/previewAssistantHandoff.ts`
- Test: `tracker/src/lib/__tests__/previewAssistantHandoff.test.ts`

- [ ] **Step 1: Write the failing test**

In `previewAssistantHandoff.test.ts`, add:

```ts
it("stashes and consumes a project warm-up handoff", () => {
  stashProjectAssistantHandoff({ projectSlug: "adv", message: "Prepare env", createdAt: Date.now() });
  const got = consumeProjectAssistantHandoff("adv");
  expect(got?.message).toBe("Prepare env");
  expect(consumeProjectAssistantHandoff("adv")).toBeNull(); // single-use
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/__tests__/previewAssistantHandoff.test.ts`
Expected: FAIL — functions undefined.

- [ ] **Step 3: Implement the project handoff**

Append to `previewAssistantHandoff.ts`:

```ts
export interface ProjectAssistantHandoff {
  projectSlug: string;
  message: string;
  createdAt: number;
}

const PROJECT_STORAGE_KEY = "symphony:project-assistant-handoff";

export function buildWarmUpBootstrapPrompt(projectSlug: string): string {
  return [
    `Prepare the dev environment for project "${projectSlug}" before any task starts.`,
    "",
    "Call manage_dev_env with action \"warm_up\" to run the deterministic warm-up",
    "(ECR login, pull/build images, boot a dry-run on an ephemeral port, confirm a",
    "tenant-aware /health for the default tenant, then tear it down).",
    "",
    "If it fails, use the returned failure_class to fix it in this thread and re-run warm_up:",
    "- image_pull_auth → refresh/ask for AWS creds (prefer the AWS profile)",
    "- needs_scaffold → scaffold the .symphony/ scripts, propose a commit, then re-run",
    "- container_name_conflict / port_allocation → inspect docker and resolve",
    "- health_timeout → read the logs and report the likely cause",
  ].join("\n");
}

export function stashProjectAssistantHandoff(handoff: ProjectAssistantHandoff): void {
  sessionStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(handoff));
}

export function consumeProjectAssistantHandoff(projectSlug: string): ProjectAssistantHandoff | null {
  const raw = sessionStorage.getItem(PROJECT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ProjectAssistantHandoff;
    if (parsed.projectSlug !== projectSlug) return null;
    sessionStorage.removeItem(PROJECT_STORAGE_KEY);
    return parsed;
  } catch {
    sessionStorage.removeItem(PROJECT_STORAGE_KEY);
    return null;
  }
}
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run src/lib/__tests__/previewAssistantHandoff.test.ts`
Expected: PASS

```bash
git add src/lib/previewAssistantHandoff.ts src/lib/__tests__/previewAssistantHandoff.test.ts
git commit -m "feat(tracker): project-scope assistant composer handoff for warm-up"
```

### Task C3: `WarmUpBanner` component + consume handoff in the project assistant route

**Files:**
- Create: `tracker/src/components/devenv/WarmUpBanner.tsx`
- Create: `tracker/src/components/devenv/__tests__/WarmUpBanner.test.tsx`
- Modify: `tracker/src/components/workspace/ProjectAssistantRoute.tsx` (consume the handoff → seed composer)

- [ ] **Step 1: Write the failing test**

Create `__tests__/WarmUpBanner.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { WarmUpBanner } from "../WarmUpBanner";

it("shows the prepare CTA when status is never", () => {
  render(<WarmUpBanner status="never" onPrepare={() => {}} />);
  expect(screen.getByRole("button", { name: /preparar ambiente/i })).toBeInTheDocument();
});

it("renders nothing when succeeded", () => {
  const { container } = render(<WarmUpBanner status="succeeded" onPrepare={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/devenv/__tests__/WarmUpBanner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `WarmUpBanner`**

Create `WarmUpBanner.tsx`:

```tsx
import { Button } from "@/components/ui/button";

export interface WarmUpBannerProps {
  status: "never" | "running" | "succeeded" | "failed";
  onPrepare: () => void;
}

export function WarmUpBanner({ status, onPrepare }: WarmUpBannerProps) {
  if (status === "succeeded") return null;

  const failed = status === "failed";
  const running = status === "running";

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span>
        {failed
          ? "O último preparo do ambiente falhou. Tente preparar novamente."
          : "Este projeto ainda não foi preparado. Prepare o ambiente antes de iniciar tarefas."}
      </span>
      <Button size="sm" onClick={onPrepare} disabled={running}>
        {running ? "Preparando…" : "Preparar ambiente"}
      </Button>
    </div>
  );
}
```

> Verify `@/components/ui/button` exports `Button` with `size`/`disabled` (it's used across the tracker). If the project uses a different primitive, mirror an existing banner (e.g. search `rounded-md border` usages).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/components/devenv/__tests__/WarmUpBanner.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Consume the handoff in `ProjectAssistantRoute`**

In `ProjectAssistantRoute.tsx`, on mount, seed the composer when a project handoff exists:

```tsx
import { consumeProjectAssistantHandoff } from "@/lib/previewAssistantHandoff";
// …inside the component, after projectSlug is known:
useEffect(() => {
  const handoff = consumeProjectAssistantHandoff(projectSlug);
  if (handoff) setComposerSeed(handoff.message); // reuse the existing composer-seed prop/state
}, [projectSlug]);
```

> Match the existing composer-seed mechanism this route already uses for preview handoffs (search `composerSeed`/`seed`/`stashPreviewAssistantHandoff` in this file and `ProjectAssistantPanel.tsx`); reuse the same prop rather than adding a new one.

- [ ] **Step 6: Commit**

```bash
git add src/components/devenv/WarmUpBanner.tsx src/components/devenv/__tests__/WarmUpBanner.test.tsx src/components/workspace/ProjectAssistantRoute.tsx
git commit -m "feat(tracker): warm-up banner + consume project assistant handoff"
```

### Task C4: Wire the banner → navigate to the assistant with the seeded prompt

**Files:**
- Modify: the project overview/board container that should host the banner (identify in Step 1).
- Modify: `tracker/src/components/devenv/DevEnvPanel.tsx` (add a re-run entry that uses the same flow).

- [ ] **Step 1: Find the project overview mount + the assistant route path**

Run: `rg -n "ProjectAssistantRoute|assistant\"|projectAssistant" src/lib/workspaceRoutes.ts src/App.tsx`
Expected: the route builder for the project assistant (e.g. `projectAssistantPath(slug)`).

- [ ] **Step 2: Implement the `onPrepare` handler**

Where the banner is mounted (project overview/board), wire:

```tsx
import { useNavigate } from "react-router-dom";
import { buildWarmUpBootstrapPrompt, stashProjectAssistantHandoff } from "@/lib/previewAssistantHandoff";
// …
const navigate = useNavigate();
const handlePrepare = () => {
  stashProjectAssistantHandoff({
    projectSlug: project.slug,
    message: buildWarmUpBootstrapPrompt(project.slug),
    createdAt: Date.now(),
  });
  navigate(projectAssistantPath(project.slug)); // path builder from Step 1
};
// …
<WarmUpBanner status={project.warmUpStatus} onPrepare={handlePrepare} />
```

- [ ] **Step 3: Add a re-run control to `DevEnvPanel`**

In `DevEnvPanel.tsx`, render the same `WarmUpBanner` (or a compact "Preparar ambiente" button) using `project.warmUpStatus` and the same `handlePrepare` flow, so re-running is available after the first success.

- [ ] **Step 4: Typecheck + targeted tests**

Run: `npx vitest run src/components/devenv && npx tsc --noEmit`
Expected: PASS / no type errors in edited files.

- [ ] **Step 5: Commit**

```bash
git add src/components/devenv/DevEnvPanel.tsx <overview_container_path>
git commit -m "feat(tracker): mount warm-up banner and wire prepare → seeded project assistant"
```

### Task C5: Frontend suite green

- [ ] **Step 1: Run the related suites + lint**

Run: `npx vitest run src/components/devenv src/services src/lib && npm run lint`
Expected: PASS, no lint errors in edited files.

---

## Self-review (spec coverage)

- **Goal 1 (one-time project warm-up)** → B3 `DevEnv.warm_up/2`, B4 tool action, C3/C4 trigger.
- **Goal 2 (full dry-run boot→/health→teardown)** → A1 `serve.sh` warm-up mode + B3 command compose.
- **Goal 3 (hybrid in a chat session)** → B4 deterministic tool + C2 bootstrap prompt with failure-class fix loop + C3 handoff seed.
- **Goal 4 (readiness state + banner)** → B1/B2 fields, B5 API, C1 mapping, C3/C4 banner.
- **Goal 5 (default tenant `illume`, authoritative health)** → A2 `common.sh`.
- **Goal 6 (reuse)** → reuses `DevEnv`, `.symphony/`, `manage_dev_env`, composer handoff (no new subsystem).
- **D5 (default tenant DB seeded)** → covered by A3 smoke + B3 command; **the explicit DB seed step is deferred** (spec §10 open item) — the warm-up surfaces `health_timeout`/`unknown` if the tenant DB is absent, and the assistant remediates. Add a dedicated `db-ready` step only once the seed path (dump vs `illumepg.py`) is chosen.
- **D6 (needs_scaffold → assistant scaffolds template)** → detection in B3; the scaffolding itself is performed by the assistant at runtime (no template file shipped in this plan — see open item).

## Open items to confirm during execution
- Exact `normalizeProject` entry point and project DTO type location (Task C1 Step 1).
- The composer-seed mechanism name in `ProjectAssistantRoute`/`ProjectAssistantPanel` (Task C3 Step 5).
- The project-overview container that should host the banner + the assistant route path builder (Task C4 Step 1).
- Whether to ship a canonical `.symphony/` template file for `needs_scaffold` now or let the assistant author it ad hoc (spec D6).
- The default-tenant DB seed path (spec §10 / D5) before adding a mandatory `db-ready` step.
