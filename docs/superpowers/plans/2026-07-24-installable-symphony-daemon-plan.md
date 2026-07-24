# Installable Symphony Daemon Implementation Plan

**Goal:** Ship Symphony as a checkout-independent OTP release managed by a
Linux/WSL `systemd --user` service, with safe persistence, lifecycle commands,
health/drift status, migration, graceful drain, and rollback.

**Architecture:** Keep the current `make serve` development daemon unchanged
and add a separate installed runtime. A versioned OTP release runs in the
foreground under systemd, while focused `SymphonyElixir.Daemon.*` modules own
XDG paths, atomic files, systemd interaction, status, migration, installation,
and shutdown admission. Both the bootstrap Mix task and installed launcher
delegate to one lifecycle API.

**Tech Stack:** Elixir 1.19, OTP 28 releases, Ecto/Exqlite SQLite, systemd user
services, ExUnit, POSIX shell launchers, Make.

**Design:** `docs/superpowers/specs/2026-07-24-installable-symphony-daemon-design.md`

---

## Execution Rules

- Run Elixir commands from `elixir/`.
- Follow TDD for each behavior: failing test, observed failure, minimal
  implementation, passing test.
- Under WSL, run exactly one test file or one narrowly targeted test filter per
  process, sequentially. Split every multi-file command below. Never run a
  directory-wide suite or repository-wide gate unless the user explicitly
  approves that specific run.
- Every public `def` under `lib/` needs an adjacent `@spec`.
- Do not stop or modify the canonical development daemon during unit work.
- Real systemd acceptance uses a unique unit name and isolated port/database.
- Never stage unrelated files. Commit after every task.
- Keep the plan checkboxes current as steps complete.

## File Structure

### New runtime modules

- `elixir/lib/symphony_elixir/daemon/paths.ex` — XDG and installation paths.
- `elixir/lib/symphony_elixir/daemon/build_info.ex` — build identity, mode,
  and process start time.
- `elixir/lib/symphony_elixir/daemon/files.ex` — atomic file/symlink helpers.
- `elixir/lib/symphony_elixir/daemon/environment.ex` — safe EnvironmentFile
  rendering.
- `elixir/lib/symphony_elixir/daemon/manifest.ex` — candidate/install manifest
  read/write.
- `elixir/lib/symphony_elixir/daemon/artifact.ex` — safe release tar staging.
- `elixir/lib/symphony_elixir/daemon/systemd/unit.ex` — pure unit renderer.
- `elixir/lib/symphony_elixir/daemon/systemd.ex` — injected command adapter.
- `elixir/lib/symphony_elixir/daemon/listener.ex` — Linux listener/PID probe.
- `elixir/lib/symphony_elixir/daemon/health_probe.ex` — raw local HTTP probe.
- `elixir/lib/symphony_elixir/daemon/preflight.ex` — non-restartable checks.
- `elixir/lib/symphony_elixir/daemon/status.ex` — combined service/health/drift
  snapshot.
- `elixir/lib/symphony_elixir/daemon/lifecycle.ex` — start/stop/restart/status/
  uninstall.
- `elixir/lib/symphony_elixir/daemon/migration.ex` — consistent SQLite
  snapshot, integrity verification, and Ecto migration.
- `elixir/lib/symphony_elixir/daemon/install.ex` — activation and rollback.
- `elixir/lib/symphony_elixir/daemon/shutdown.ex` — admission gate and drain.
- `elixir/lib/symphony_elixir/daemon/cli.ex` — shared parser/presenter.
- `elixir/lib/symphony_elixir/release.ex` — release-eval entrypoints.
- `elixir/lib/mix/tasks/symphony.daemon.ex` — checkout/bootstrap command.

### New release templates

- `elixir/rel/env.sh.eex` — disable distribution and set release tmp.
- `elixir/rel/overlays/bin/symphony-service` — preflight then foreground boot.
- `elixir/rel/overlays/bin/symphony-daemon` — management command via release
  `eval`.

### Existing files to modify

- `elixir/mix.exs` — named release, asset-copy step, tar step.
- `elixir/config/runtime.exs` — installed-mode XDG runtime configuration.
- `elixir/lib/symphony_elixir.ex` — record start time and drain in
  `prep_stop/1`.
- `elixir/lib/symphony_elixir/shared_supervisor.ex` — supervise shutdown gate.
- `elixir/lib/symphony_elixir/orchestrator.ex` — stop dispatch while draining.
- `elixir/lib/symphony_elixir/assistant/turn_manager.ex` — admission check,
  active IDs, bulk interrupt.
- `elixir/lib/symphony_elixir/cli.ex` — `daemon` management subcommand.
- `elixir/lib/symphony_elixir_web/controllers/health_controller.ex` — release
  identity payload.
- `elixir/Makefile` — release/package/daemon bootstrap targets.
- `INSTALL.md` and `elixir/README.md` — operator documentation.

---

### Task 1: XDG path contract

**Files:**
- Create: `elixir/lib/symphony_elixir/daemon/paths.ex`
- Test: `elixir/test/symphony_elixir/daemon/paths_test.exs`

- [x] **Step 1: Write failing XDG path tests**

```elixir
defmodule SymphonyElixir.Daemon.PathsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Paths

  test "defaults every persistent path under the user home" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})

    assert paths.config_dir == "/home/alice/.config/symphony"
    assert paths.env_file == "/home/alice/.config/symphony/symphony.env"
    assert paths.unit_file == "/home/alice/.config/systemd/user/symphony.service"
    assert paths.data_dir == "/home/alice/.local/share/symphony"
    assert paths.database == "/home/alice/.local/share/symphony/tracker.sqlite3"
    assert paths.backup_dir == "/home/alice/.local/share/symphony/backups"
    assert paths.state_dir == "/home/alice/.local/state/symphony"
    assert paths.log_dir == "/home/alice/.local/state/symphony/log"
    assert paths.releases_dir == "/home/alice/.local/lib/symphony/releases"
    assert paths.current_link == "/home/alice/.local/lib/symphony/current"
    assert paths.launcher == "/home/alice/.local/bin/symphony"
  end

  test "honors XDG roots and an isolated unit name" do
    paths =
      Paths.resolve(%{
        "HOME" => "/home/alice",
        "XDG_CONFIG_HOME" => "/cfg",
        "XDG_DATA_HOME" => "/data",
        "XDG_STATE_HOME" => "/state",
        "SYMPHONY_CONFIG_DIR" => "/private/config",
        "SYMPHONY_SYSTEMD_USER_DIR" => "/systemd/user",
        "SYMPHONY_LAUNCHER_PATH" => "/private/bin/symphony",
        "SYMPHONY_INSTALL_ROOT" => "/opt/user/symphony",
        "SYMPHONY_DAEMON_UNIT" => "symphony-acceptance.service"
      })

    assert paths.env_file == "/private/config/symphony.env"
    assert paths.database == "/data/symphony/tracker.sqlite3"
    assert paths.log_dir == "/state/symphony/log"
    assert paths.releases_dir == "/opt/user/symphony/releases"
    assert paths.launcher == "/private/bin/symphony"
    assert paths.unit_file ==
             "/systemd/user/symphony-acceptance.service"
  end

  test "rejects a missing home and unsafe unit names" do
    assert_raise ArgumentError, ~r/HOME/, fn -> Paths.resolve(%{}) end

    assert_raise ArgumentError, ~r/unit name/, fn ->
      Paths.resolve(%{
        "HOME" => "/home/alice",
        "SYMPHONY_DAEMON_UNIT" => "../escape.service"
      })
    end
  end
end
```

- [x] **Step 2: Run the test and observe the missing module**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/paths_test.exs
```

Expected: FAIL because `SymphonyElixir.Daemon.Paths` is undefined.

- [x] **Step 3: Implement the path struct and resolver**

```elixir
defmodule SymphonyElixir.Daemon.Paths do
  @moduledoc "Resolves all installed-daemon filesystem paths."

  @enforce_keys [
    :home,
    :config_dir,
    :env_file,
    :unit_file,
    :data_dir,
    :install_manifest,
    :database,
    :backup_dir,
    :state_dir,
    :log_dir,
    :install_root,
    :releases_dir,
    :current_link,
    :launcher,
    :unit_name
  ]
  defstruct @enforce_keys

  @type t :: %__MODULE__{
          home: Path.t(),
          config_dir: Path.t(),
          env_file: Path.t(),
          unit_file: Path.t(),
          data_dir: Path.t(),
          install_manifest: Path.t(),
          database: Path.t(),
          backup_dir: Path.t(),
          state_dir: Path.t(),
          log_dir: Path.t(),
          install_root: Path.t(),
          releases_dir: Path.t(),
          current_link: Path.t(),
          launcher: Path.t(),
          unit_name: String.t()
        }

  @unit_pattern ~r/\A[a-zA-Z0-9_.@-]+\.service\z/

  @spec resolve(map()) :: t()
  def resolve(env \\ System.get_env()) when is_map(env) do
    home = required_home(env)
    config_home = value(env, "XDG_CONFIG_HOME", Path.join(home, ".config"))
    data_home = value(env, "XDG_DATA_HOME", Path.join(home, ".local/share"))
    state_home = value(env, "XDG_STATE_HOME", Path.join(home, ".local/state"))
    install_root = value(env, "SYMPHONY_INSTALL_ROOT", Path.join(home, ".local/lib/symphony"))
    launcher =
      value(
        env,
        "SYMPHONY_LAUNCHER_PATH",
        Path.join([home, ".local", "bin", "symphony"])
      )

    unit_name = string_value(env, "SYMPHONY_DAEMON_UNIT", "symphony.service")

    unless Regex.match?(@unit_pattern, unit_name) do
      raise ArgumentError, "invalid daemon unit name: #{inspect(unit_name)}"
    end

    config_dir =
      value(env, "SYMPHONY_CONFIG_DIR", Path.join(config_home, "symphony"))

    systemd_user_dir =
      value(
        env,
        "SYMPHONY_SYSTEMD_USER_DIR",
        Path.join([config_home, "systemd", "user"])
      )

    data_dir = Path.join(data_home, "symphony")
    state_dir = Path.join(state_home, "symphony")

    %__MODULE__{
      home: home,
      config_dir: config_dir,
      env_file: Path.join(config_dir, "symphony.env"),
      unit_file: Path.join(systemd_user_dir, unit_name),
      data_dir: data_dir,
      install_manifest: Path.join(data_dir, "install.json"),
      database: Path.join(data_dir, "tracker.sqlite3"),
      backup_dir: Path.join(data_dir, "backups"),
      state_dir: state_dir,
      log_dir: Path.join(state_dir, "log"),
      install_root: install_root,
      releases_dir: Path.join(install_root, "releases"),
      current_link: Path.join(install_root, "current"),
      launcher: launcher,
      unit_name: unit_name
    }
  end

  defp required_home(env) do
    case Map.get(env, "HOME") do
      value when is_binary(value) and value != "" -> Path.expand(value)
      _ -> raise ArgumentError, "HOME is required for a user daemon"
    end
  end

  defp value(env, key, default) do
    case Map.get(env, key) do
      value when is_binary(value) and value != "" -> Path.expand(value)
      _ -> Path.expand(default)
    end
  end

  defp string_value(env, key, default) do
    case Map.get(env, key) do
      value when is_binary(value) and value != "" -> value
      _ -> default
    end
  end
end
```

- [x] **Step 4: Run the focused test**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/paths_test.exs
mix specs.check
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/daemon/paths.ex \
  elixir/test/symphony_elixir/daemon/paths_test.exs
git commit -m "feat(daemon): define installed XDG paths"
```

---

### Task 2: Build identity, installed runtime config, and health payload

**Files:**
- Create: `elixir/lib/symphony_elixir/daemon/build_info.ex`
- Modify: `elixir/config/runtime.exs`
- Modify: `elixir/lib/symphony_elixir.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/health_controller.ex`
- Test: `elixir/test/symphony_elixir/daemon/build_info_test.exs`
- Test: `elixir/test/symphony_elixir_web/health_controller_test.exs`

- [x] **Step 1: Write failing identity and health tests**

```elixir
defmodule SymphonyElixir.Daemon.BuildInfoTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Daemon.BuildInfo

  setup do
    previous = Application.get_env(:symphony_elixir, :build_info)
    on_exit(fn -> Application.put_env(:symphony_elixir, :build_info, previous) end)
  end

  test "snapshot exposes configured build identity without paths or secrets" do
    Application.put_env(:symphony_elixir, :build_info, %{
      version: "1.2.3",
      git_commit: "abc123",
      mode: "installed"
    })

    BuildInfo.mark_started(~U[2026-07-24 12:00:00Z])

    assert BuildInfo.snapshot() == %{
             version: "1.2.3",
             git_commit: "abc123",
             mode: "installed",
             started_at: "2026-07-24T12:00:00Z"
           }
  end
end
```

Replace the existing health assertion with:

```elixir
test "GET /api/health returns build identity without authentication" do
  Application.put_env(:symphony_elixir, :build_info, %{
    version: "0.3.0",
    git_commit: "test-commit",
    mode: "development"
  })

  SymphonyElixir.Daemon.BuildInfo.mark_started(~U[2026-07-24 12:00:00Z])
  conn = get(build_conn(), "/api/health")

  assert json_response(conn, 200) == %{
           "status" => "ok",
           "version" => "0.3.0",
           "git_commit" => "test-commit",
           "started_at" => "2026-07-24T12:00:00Z",
           "mode" => "development"
         }
end
```

- [x] **Step 2: Run the tests and observe failure**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/build_info_test.exs \
  test/symphony_elixir_web/health_controller_test.exs
```

Expected: FAIL because `BuildInfo` is undefined and health only returns
`status`.

- [x] **Step 3: Implement build identity and health serialization**

```elixir
defmodule SymphonyElixir.Daemon.BuildInfo do
  @moduledoc "Runtime identity for health and daemon drift checks."

  @started_key {__MODULE__, :started_at}
  @default_version Application.compile_env(:symphony_elixir, :app_version, "dev")
  @default_commit Application.compile_env(:symphony_elixir, :git_commit, "unknown")

  @spec mark_started(DateTime.t()) :: :ok
  def mark_started(now \\ DateTime.utc_now()) do
    :persistent_term.put(@started_key, DateTime.truncate(now, :second))
    :ok
  end

  @spec snapshot() :: map()
  def snapshot do
    configured =
      Application.get_env(:symphony_elixir, :build_info, %{
        version: @default_version,
        git_commit: @default_commit,
        mode: runtime_mode()
      })

    %{
      version: to_string(configured[:version] || @default_version),
      git_commit: to_string(configured[:git_commit] || @default_commit),
      mode: to_string(configured[:mode] || runtime_mode()),
      started_at: started_at() |> DateTime.to_iso8601()
    }
  end

  defp started_at do
    :persistent_term.get(
      @started_key,
      DateTime.utc_now() |> DateTime.truncate(:second)
    )
  end

  defp runtime_mode do
    if System.get_env("SYMPHONY_RUNTIME_MODE") == "installed",
      do: "installed",
      else: "development"
  end
end
```

In `SymphonyElixir.Application.start/2`, call:

```elixir
:ok = SymphonyElixir.Daemon.BuildInfo.mark_started()
```

Change `HealthController.show/2` to:

```elixir
@spec show(Conn.t(), map()) :: Conn.t()
def show(conn, _params) do
  identity = SymphonyElixir.Daemon.BuildInfo.snapshot()
  json(conn, Map.put(identity, :status, "ok"))
end
```

- [x] **Step 4: Configure installed paths only at runtime**

Append inside the existing non-test block of `config/runtime.exs`:

```elixir
if System.get_env("SYMPHONY_RUNTIME_MODE") == "installed" do
  paths = SymphonyElixir.Daemon.Paths.resolve()
  version = System.get_env("RELEASE_VSN") || "unknown"
  git_commit = System.get_env("SYMPHONY_BUILD_COMMIT") || "unknown"

  config :symphony_elixir,
    root_dir: paths.data_dir,
    backup_local_dir: paths.backup_dir,
    skills_root: Application.app_dir(:symphony_elixir, "priv/skills"),
    log_file: Path.join(paths.log_dir, "symphony.log"),
    sql_log_file: Path.join(paths.log_dir, "symphony.sql.log"),
    build_info: %{
      version: version,
      git_commit: git_commit,
      mode: "installed"
    }

  config :symphony_elixir, SymphonyElixir.Repo, database: paths.database
end
```

In `mix.exs`, bind the existing version once at the top of `project/0` and use
it for the existing `:version` key:

```elixir
app_version = "0.3.0"
```

Replace the current `version: "0.3.0"` entry with
`version: app_version`; retain every other existing project entry unchanged.
In `config/config.exs` add:

```elixir
config :symphony_elixir,
  app_version: Mix.Project.config()[:version],
  git_commit: System.get_env("SYMPHONY_BUILD_COMMIT") || "development"
```

- [x] **Step 5: Run focused and config tests**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/build_info_test.exs \
  test/symphony_elixir_web/health_controller_test.exs
mix specs.check
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add elixir/config/config.exs elixir/config/runtime.exs elixir/mix.exs \
  elixir/lib/symphony_elixir.ex \
  elixir/lib/symphony_elixir/daemon/build_info.ex \
  elixir/lib/symphony_elixir_web/controllers/health_controller.ex \
  elixir/test/symphony_elixir/daemon/build_info_test.exs \
  elixir/test/symphony_elixir_web/health_controller_test.exs
git commit -m "feat(daemon): expose installed build identity"
```

---

### Task 3: Self-contained OTP release and bundled skills

**Files:**
- Modify: `elixir/mix.exs`
- Create: `elixir/rel/env.sh.eex`
- Create: `elixir/rel/overlays/bin/symphony-service`
- Create: `elixir/rel/overlays/bin/symphony-daemon`
- Create: `elixir/lib/symphony_elixir/release.ex`
- Test: `elixir/test/symphony_elixir/release_test.exs`

- [x] **Step 1: Write a failing release contract test**

```elixir
defmodule SymphonyElixir.ReleaseTest do
  use ExUnit.Case, async: true

  test "release configuration includes ERTS, Unix scripts, and tar packaging" do
    config = SymphonyElixir.MixProject.project()
    release = config[:releases][:symphony]

    assert release[:include_erts] == true
    assert release[:include_executables_for] == [:unix]
    assert :assemble in release[:steps]
    assert :tar in release[:steps]
  end

  test "release daemon launcher delegates argv without shell interpolation" do
    script = File.read!("rel/overlays/bin/symphony-daemon")

    assert script =~ "Release.daemon(System.argv())"
    assert script =~ ~s(exec "$release_root/bin/symphony" eval)
    refute script =~ "sh -c"
  end
end
```

- [x] **Step 2: Run the test and observe missing release configuration**

Run:

```bash
cd elixir
mix test test/symphony_elixir/release_test.exs
```

Expected: FAIL because `:releases` and overlay files do not exist.

- [x] **Step 3: Add the named release and asset-copy step**

Add `releases: releases()` to `project/0`, then:

```elixir
defp releases do
  [
    symphony: [
      include_erts: true,
      include_executables_for: [:unix],
      applications: [runtime_tools: :permanent],
      steps: [:assemble, &copy_release_assets/1, :tar]
    ]
  ]
end

defp copy_release_assets(%Mix.Release{} = release) do
  app_version = to_string(release.version)

  app_priv =
    Path.join([
      release.path,
      "lib",
      "symphony_elixir-#{app_version}",
      "priv"
    ])

  source_skills = Path.expand("../skills", __DIR__)
  target_skills = Path.join(app_priv, "skills")
  File.rm_rf!(target_skills)
  File.cp_r!(source_skills, target_skills)

  build_commit =
    System.get_env("SYMPHONY_BUILD_COMMIT") ||
      case System.cmd("git", ["rev-parse", "HEAD"],
             cd: Path.expand("..", __DIR__),
             stderr_to_stdout: true
           ) do
        {commit, 0} -> String.trim(commit)
        _ -> "unknown"
      end

  manifest = %{
    "version" => to_string(release.version),
    "git_commit" => build_commit,
    "system_architecture" =>
      :erlang.system_info(:system_architecture) |> to_string(),
    "built_at" =>
      DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()
  }

  File.write!(
    Path.join(release.path, "manifest.json"),
    Jason.encode_to_iodata!(manifest, pretty: true)
  )

  release
end
```

- [x] **Step 4: Add release entrypoints and templates**

Create `lib/symphony_elixir/release.ex`:

```elixir
defmodule SymphonyElixir.Release do
  @moduledoc "One-off entrypoints invoked by OTP release scripts."

  alias SymphonyElixir.Daemon.{CLI, Preflight}

  @spec daemon([String.t()]) :: no_return()
  def daemon(argv) when is_list(argv) do
    CLI.main(argv)
  end

  @spec preflight() :: no_return()
  def preflight do
    case Preflight.run() do
      {:ok, _warnings} -> System.halt(0)
      {:error, message} ->
        IO.puts(:stderr, message)
        System.halt(78)
    end
  end
end
```

Create `rel/env.sh.eex`:

```sh
#!/bin/sh
export RELEASE_DISTRIBUTION=none
export RELEASE_NODE=symphony
export RELEASE_TMP="${XDG_STATE_HOME:-$HOME/.local/state}/symphony/release-tmp"
```

Create `rel/overlays/bin/symphony-service`:

```sh
#!/bin/sh
set -eu
release_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
"$release_root/bin/symphony" eval \
  'SymphonyElixir.Release.preflight()'
exec "$release_root/bin/symphony" start
```

Create `rel/overlays/bin/symphony-daemon`:

```sh
#!/bin/sh
set -eu
release_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$release_root/bin/symphony" eval \
  'SymphonyElixir.Release.daemon(System.argv())' -- "$@"
```

Make both overlays executable in git.

- [x] **Step 5: Run unit and real release smoke checks**

Run:

```bash
cd elixir
mix test test/symphony_elixir/release_test.exs
MIX_ENV=prod SYMPHONY_BUILD_COMMIT="$(git rev-parse HEAD)" \
  mix release symphony --overwrite
test -x _build/prod/rel/symphony/bin/symphony-service
test -x _build/prod/rel/symphony/bin/symphony-daemon
test -f _build/prod/rel/symphony/manifest.json
test -f _build/prod/rel/symphony/lib/symphony_elixir-0.3.0/priv/skills/superpowers/using-superpowers/SKILL.md
_build/prod/rel/symphony/bin/symphony eval \
  'Application.ensure_all_started(:exqlite); {:ok, db} = Exqlite.Sqlite3.open(":memory:"); :ok = Exqlite.Sqlite3.close(db); IO.puts("sqlite-ok")'
```

Expected: tests PASS and the last command prints `sqlite-ok`.

- [x] **Step 6: Commit**

```bash
git add elixir/mix.exs elixir/rel \
  elixir/lib/symphony_elixir/release.ex \
  elixir/test/symphony_elixir/release_test.exs
git commit -m "feat(daemon): package a self-contained OTP release"
```

---

### Task 4: Atomic files, environment, and manifests

**Files:**
- Create: `elixir/lib/symphony_elixir/daemon/files.ex`
- Create: `elixir/lib/symphony_elixir/daemon/environment.ex`
- Create: `elixir/lib/symphony_elixir/daemon/manifest.ex`
- Test: `elixir/test/symphony_elixir/daemon/files_test.exs`
- Test: `elixir/test/symphony_elixir/daemon/environment_test.exs`
- Test: `elixir/test/symphony_elixir/daemon/manifest_test.exs`

- [ ] **Step 1: Write failing atomic-write and rendering tests**

```elixir
defmodule SymphonyElixir.Daemon.FilesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Files

  test "atomic_write replaces content and applies the requested mode" do
    root = Path.join(System.tmp_dir!(), "daemon-files-#{System.unique_integer([:positive])}")
    path = Path.join(root, "config/value")
    on_exit(fn -> File.rm_rf!(root) end)

    assert :ok = Files.atomic_write(path, "first", 0o600)
    assert :ok = Files.atomic_write(path, "second", 0o600)
    assert File.read!(path) == "second"
    assert {:ok, %{mode: mode}} = File.stat(path)
    assert Bitwise.band(mode, 0o777) == 0o600
  end

  test "atomic_symlink switches targets without deleting either release" do
    root = Path.join(System.tmp_dir!(), "daemon-link-#{System.unique_integer([:positive])}")
    one = Path.join(root, "one")
    two = Path.join(root, "two")
    link = Path.join(root, "current")
    File.mkdir_p!(one)
    File.mkdir_p!(two)
    on_exit(fn -> File.rm_rf!(root) end)

    assert :ok = Files.atomic_symlink(one, link)
    assert :ok = Files.atomic_symlink(two, link)
    assert File.read_link!(link) == two
    assert File.dir?(one)
    assert File.dir?(two)
  end
end
```

```elixir
defmodule SymphonyElixir.Daemon.EnvironmentTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Environment

  test "render keeps only PATH, locale, and the SYMPHONY namespace" do
    rendered =
      Environment.render(%{
        "PATH" => "/usr/bin:/home/a b/bin",
        "LANG" => "pt_BR.UTF-8",
        "SYMPHONY_TRACKER_TOKEN" => "quote\"slash\\",
        "GITHUB_TOKEN" => "must-not-copy",
        "BASH_FUNC_x" => "must-not-copy"
      })

    assert rendered =~ ~s(PATH="/usr/bin:/home/a b/bin")
    assert rendered =~ ~s(SYMPHONY_TRACKER_TOKEN="quote\\\"slash\\\\")
    refute rendered =~ "GITHUB_TOKEN"
    refute rendered =~ "BASH_FUNC"
  end

  test "render rejects newlines and NUL bytes" do
    assert_raise ArgumentError, ~r/unsafe environment value/, fn ->
      Environment.render(%{"SYMPHONY_BAD" => "one\ntwo"})
    end

    assert_raise ArgumentError, ~r/unsafe environment value/, fn ->
      Environment.render(%{"SYMPHONY_BAD" => "one\0two"})
    end
  end
end
```

```elixir
defmodule SymphonyElixir.Daemon.ManifestTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Manifest

  test "round-trips a manifest through an atomic JSON write" do
    root = Path.join(System.tmp_dir!(), "daemon-manifest-#{System.unique_integer([:positive])}")
    path = Path.join(root, "install.json")
    on_exit(fn -> File.rm_rf!(root) end)

    manifest = %{
      "version" => "0.3.0",
      "git_commit" => "abc",
      "artifact_sha256" => String.duplicate("0", 64)
    }

    assert :ok = Manifest.write(path, manifest)
    assert {:ok, ^manifest} = Manifest.read(path)
    assert {:error, :missing} = Manifest.read(path <> ".missing")
  end
end
```

- [ ] **Step 2: Run tests and observe missing modules**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/files_test.exs \
  test/symphony_elixir/daemon/environment_test.exs \
  test/symphony_elixir/daemon/manifest_test.exs
```

Expected: FAIL with undefined modules.

- [ ] **Step 3: Implement atomic files**

```elixir
defmodule SymphonyElixir.Daemon.Files do
  @moduledoc "Crash-safe writes used by daemon installation."

  @spec atomic_write(Path.t(), iodata(), non_neg_integer()) ::
          :ok | {:error, term()}
  def atomic_write(path, contents, mode) do
    :ok = File.mkdir_p(Path.dirname(path))
    temp = path <> ".tmp.#{System.unique_integer([:positive, :monotonic])}"

    with {:ok, file} <- File.open(temp, [:write, :binary, :exclusive]),
         :ok <- IO.binwrite(file, contents),
         :ok <- :file.sync(file),
         :ok <- File.close(file),
         :ok <- File.chmod(temp, mode),
         :ok <- File.rename(temp, path) do
      :ok
    else
      {:error, reason} = error ->
        File.rm(temp)
        if reason == :eexist, do: atomic_write(path, contents, mode), else: error
    end
  end

  @spec atomic_symlink(Path.t(), Path.t()) :: :ok | {:error, term()}
  def atomic_symlink(target, link) do
    :ok = File.mkdir_p(Path.dirname(link))
    temp = link <> ".tmp.#{System.unique_integer([:positive, :monotonic])}"

    with :ok <- File.ln_s(target, temp),
         :ok <- replace_link(temp, link) do
      :ok
    else
      {:error, _reason} = error ->
        File.rm(temp)
        error
    end
  end

  defp replace_link(temp, link) do
    case File.rename(temp, link) do
      :ok -> :ok
      {:error, :eexist} ->
        :ok = File.rm(link)
        File.rename(temp, link)
      error -> error
    end
  end
end
```

During implementation, use `:file.sync(file)` with the actual IO device shape
accepted by OTP 28; the test must prove the final helper works on this runtime.

- [ ] **Step 4: Implement safe environment and manifest modules**

```elixir
defmodule SymphonyElixir.Daemon.Environment do
  @moduledoc "Renders the controlled systemd EnvironmentFile contract."

  @spec render(map()) :: String.t()
  def render(env) when is_map(env) do
    env
    |> Enum.filter(fn {key, _value} ->
      key in ["PATH", "HOME", "LANG", "LC_ALL"] or
        String.starts_with?(key, "SYMPHONY_")
    end)
    |> Enum.sort_by(&elem(&1, 0))
    |> Enum.map_join("", fn {key, value} ->
      validate_key!(key)
      "#{key}=\"#{escape(to_string(value))}\"\n"
    end)
  end

  defp validate_key!(key) do
    unless Regex.match?(~r/\A[A-Z_][A-Z0-9_]*\z/, key) do
      raise ArgumentError, "unsafe environment key: #{inspect(key)}"
    end
  end

  defp escape(value) do
    if String.contains?(value, ["\n", "\r", "\0"]) do
      raise ArgumentError, "unsafe environment value"
    end

    value
    |> String.replace("\\", "\\\\")
    |> String.replace("\"", "\\\"")
  end
end
```

```elixir
defmodule SymphonyElixir.Daemon.Manifest do
  @moduledoc "Reads and writes daemon candidate and installation manifests."

  alias SymphonyElixir.Daemon.Files

  @spec read(Path.t()) :: {:ok, map()} | {:error, :missing | :invalid}
  def read(path) do
    with {:ok, body} <- File.read(path),
         {:ok, %{} = decoded} <- Jason.decode(body) do
      {:ok, decoded}
    else
      {:error, :enoent} -> {:error, :missing}
      _ -> {:error, :invalid}
    end
  end

  @spec write(Path.t(), map()) :: :ok | {:error, term()}
  def write(path, manifest) when is_map(manifest) do
    Files.atomic_write(path, Jason.encode_to_iodata!(manifest, pretty: true), 0o644)
  end
end
```

- [ ] **Step 5: Run tests and specs**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/files_test.exs \
  test/symphony_elixir/daemon/environment_test.exs \
  test/symphony_elixir/daemon/manifest_test.exs
mix specs.check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/daemon/{files,environment,manifest}.ex \
  elixir/test/symphony_elixir/daemon/{files,environment,manifest}_test.exs
git commit -m "feat(daemon): add atomic installation primitives"
```

---

### Task 5: systemd unit, command adapter, and listener ownership

**Files:**
- Create: `elixir/lib/symphony_elixir/daemon/systemd/unit.ex`
- Create: `elixir/lib/symphony_elixir/daemon/systemd.ex`
- Create: `elixir/lib/symphony_elixir/daemon/listener.ex`
- Test: `elixir/test/symphony_elixir/daemon/systemd/unit_test.exs`
- Test: `elixir/test/symphony_elixir/daemon/systemd_test.exs`
- Test: `elixir/test/symphony_elixir/daemon/listener_test.exs`

- [ ] **Step 1: Write failing unit and adapter tests**

```elixir
defmodule SymphonyElixir.Daemon.Systemd.UnitTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.{Paths, Systemd.Unit}

  test "renders restart, drain, cgroup, and absolute path contracts" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})
    unit = Unit.render(paths)

    assert unit =~ "EnvironmentFile=/home/alice/.config/symphony/symphony.env"
    assert unit =~ "ExecStart=/home/alice/.local/lib/symphony/current/bin/symphony-service"
    assert unit =~ "Restart=always"
    assert unit =~ "RestartPreventExitStatus=78"
    assert unit =~ "StartLimitBurst=5"
    assert unit =~ "TimeoutStopSec=330"
    assert unit =~ "KillMode=control-group"
    assert unit =~ "OOMPolicy=continue"
    assert unit =~ "WantedBy=default.target"
  end
end
```

```elixir
defmodule SymphonyElixir.Daemon.SystemdTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Systemd

  test "show normalizes systemctl properties" do
    runner = fn "systemctl", args, _opts ->
      assert args == [
               "--user",
               "show",
               "symphony.service",
               "--property=LoadState,UnitFileState,ActiveState,SubState,MainPID,NRestarts,Result",
               "--no-pager"
             ]

      {"LoadState=loaded\nUnitFileState=enabled\nActiveState=active\nSubState=running\nMainPID=42\nNRestarts=3\nResult=success\n", 0}
    end

    assert {:ok, info} = Systemd.show("symphony.service", runner: runner)
    assert info["MainPID"] == "42"
    assert info["NRestarts"] == "3"
  end

  test "nonzero commands return a redacted stable error" do
    runner = fn _, _, _ -> {"Failed to connect to bus", 1} end

    assert {:error, {:command_failed, 1, "Failed to connect to bus"}} =
             Systemd.start("symphony.service", runner: runner)
  end
end
```

```elixir
defmodule SymphonyElixir.Daemon.ListenerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Listener

  test "parses listener pids from ss output" do
    output =
      ~s(LISTEN 0 1024 127.0.0.1:4000 0.0.0.0:* users:(("beam.smp",pid=4242,fd=39))\n)

    assert {:owned, [4242]} = Listener.parse(output)
    assert :free = Listener.parse("")
  end
end
```

- [ ] **Step 2: Run tests and observe missing modules**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/systemd/unit_test.exs \
  test/symphony_elixir/daemon/systemd_test.exs \
  test/symphony_elixir/daemon/listener_test.exs
```

Expected: FAIL.

- [ ] **Step 3: Implement deterministic unit rendering**

```elixir
defmodule SymphonyElixir.Daemon.Systemd.Unit do
  @moduledoc "Pure renderer for the Symphony user service."

  alias SymphonyElixir.Daemon.Paths

  @spec render(Paths.t()) :: String.t()
  def render(%Paths{} = paths) do
    """
    [Unit]
    Description=Symphony daemon
    Wants=network-online.target
    After=network-online.target
    StartLimitIntervalSec=60
    StartLimitBurst=5

    [Service]
    Type=simple
    EnvironmentFile=#{escape(paths.env_file)}
    WorkingDirectory=#{escape(paths.data_dir)}
    ExecStart=#{escape(Path.join(paths.current_link, "bin/symphony-service"))}
    Restart=always
    RestartSec=5
    RestartPreventExitStatus=78
    SuccessExitStatus=0 143
    TimeoutStopSec=330
    KillMode=control-group
    OOMPolicy=continue

    [Install]
    WantedBy=default.target
    """
  end

  defp escape(path) do
    if String.contains?(path, ["\n", "\r", "\0"]) do
      raise ArgumentError, "unsafe systemd path"
    end

    String.replace(path, " ", "\\x20")
  end
end
```

- [ ] **Step 4: Implement systemd argv calls and parsing**

```elixir
defmodule SymphonyElixir.Daemon.Systemd do
  @moduledoc "Typed adapter around user systemd commands."

  @properties "LoadState,UnitFileState,ActiveState,SubState,MainPID,NRestarts,Result"
  @type runner :: (String.t(), [String.t()], keyword() ->
                     {String.t(), non_neg_integer()})

  @spec show(String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def show(unit, opts \\ []) do
    with {:ok, output} <-
           command(
             "systemctl",
             ["--user", "show", unit, "--property=#{@properties}", "--no-pager"],
             opts
           ) do
      {:ok, parse_properties(output)}
    end
  end

  @spec daemon_reload(keyword()) :: :ok | {:error, term()}
  def daemon_reload(opts \\ []),
    do: ok_command("systemctl", ["--user", "daemon-reload"], opts)

  @spec enable_now(String.t(), keyword()) :: :ok | {:error, term()}
  def enable_now(unit, opts \\ []),
    do: ok_command("systemctl", ["--user", "enable", "--now", unit], opts)

  @spec start(String.t(), keyword()) :: :ok | {:error, term()}
  def start(unit, opts \\ []),
    do: ok_command("systemctl", ["--user", "start", unit], opts)

  @spec stop(String.t(), keyword()) :: :ok | {:error, term()}
  def stop(unit, opts \\ []),
    do: ok_command("systemctl", ["--user", "stop", unit], opts)

  @spec restart(String.t(), keyword()) :: :ok | {:error, term()}
  def restart(unit, opts \\ []),
    do: ok_command("systemctl", ["--user", "restart", unit], opts)

  @spec force_restart(String.t(), keyword()) :: :ok | {:error, term()}
  def force_restart(unit, opts \\ []) do
    ok_command(
      "systemctl",
      ["--user", "kill", "--kill-whom=all", "--signal=SIGKILL", unit],
      opts
    )
  end

  @spec disable_now(String.t(), keyword()) :: :ok | {:error, term()}
  def disable_now(unit, opts \\ []),
    do: ok_command("systemctl", ["--user", "disable", "--now", unit], opts)

  @spec enable_linger(String.t(), keyword()) :: :ok | {:error, term()}
  def enable_linger(user, opts \\ []),
    do: ok_command("loginctl", ["enable-linger", user], opts)

  @spec linger(String.t(), keyword()) ::
          {:ok, boolean()} | {:error, term()}
  def linger(user, opts \\ []) do
    with {:ok, output} <-
           command("loginctl", ["show-user", user, "--property=Linger", "--value"], opts) do
      {:ok, String.trim(output) == "yes"}
    end
  end

  defp ok_command(executable, args, opts) do
    case command(executable, args, opts) do
      {:ok, _output} -> :ok
      error -> error
    end
  end

  defp command(executable, args, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/3)

    case runner.(executable, args, stderr_to_stdout: true) do
      {output, 0} -> {:ok, output}
      {output, status} ->
        {:error, {:command_failed, status, String.trim(output)}}
    end
  end

  defp default_runner(executable, args, opts) do
    System.cmd(executable, args, opts)
  end

  defp parse_properties(output) do
    output
    |> String.split("\n", trim: true)
    |> Map.new(fn line ->
      [key, value] = String.split(line, "=", parts: 2)
      {key, value}
    end)
  end
end
```

- [ ] **Step 5: Implement the Linux listener probe**

```elixir
defmodule SymphonyElixir.Daemon.Listener do
  @moduledoc "Finds Linux listener PIDs through `ss` without mutating them."

  @type result :: :free | {:owned, [pos_integer()]} | {:unknown, term()}

  @spec probe(non_neg_integer(), keyword()) :: result()
  def probe(port, opts \\ []) when is_integer(port) and port >= 0 do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    case runner.(
           "ss",
           ["-H", "-ltnp", "sport = :#{port}"],
           stderr_to_stdout: true
         ) do
      {output, 0} -> parse(output)
      {output, status} -> {:unknown, {:ss_failed, status, String.trim(output)}}
    end
  rescue
    error -> {:unknown, error}
  end

  @spec parse(String.t()) :: :free | {:owned, [pos_integer()]}
  def parse(output) when is_binary(output) do
    pids =
      ~r/pid=(\d+)/
      |> Regex.scan(output, capture: :all_but_first)
      |> Enum.map(fn [pid] -> String.to_integer(pid) end)
      |> Enum.uniq()
      |> Enum.sort()

    if String.trim(output) == "", do: :free, else: {:owned, pids}
  end
end
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/systemd/unit_test.exs \
  test/symphony_elixir/daemon/systemd_test.exs \
  test/symphony_elixir/daemon/listener_test.exs
mix specs.check
```

Expected: PASS.

```bash
git add elixir/lib/symphony_elixir/daemon/systemd \
  elixir/lib/symphony_elixir/daemon/{systemd,listener}.ex \
  elixir/test/symphony_elixir/daemon/systemd \
  elixir/test/symphony_elixir/daemon/{systemd,listener}_test.exs
git commit -m "feat(daemon): add systemd service adapter"
```

---

### Task 6: Health probe, preflight, and drift-aware status

**Files:**
- Create: `elixir/lib/symphony_elixir/daemon/health_probe.ex`
- Create: `elixir/lib/symphony_elixir/daemon/preflight.ex`
- Create: `elixir/lib/symphony_elixir/daemon/status.ex`
- Test: `elixir/test/symphony_elixir/daemon/health_probe_test.exs`
- Test: `elixir/test/symphony_elixir/daemon/preflight_test.exs`
- Test: `elixir/test/symphony_elixir/daemon/status_test.exs`

- [ ] **Step 1: Write failing health and status classification tests**

```elixir
defmodule SymphonyElixir.Daemon.HealthProbeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.HealthProbe

  test "parse accepts only a 200 JSON health response" do
    response =
      "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n" <>
        ~s({"status":"ok","version":"0.3.0","git_commit":"abc","mode":"installed"})

    assert {:ok, %{"status" => "ok", "version" => "0.3.0"}} =
             HealthProbe.parse(response)

    assert {:error, {:http_status, 503}} =
             HealthProbe.parse("HTTP/1.1 503 Down\r\n\r\n{}")
  end
end
```

```elixir
defmodule SymphonyElixir.Daemon.StatusTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.{Paths, Status}

  test "healthy requires active service, matching pid, probe, version, and unit" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})

    deps = %{
      manifest: fn _ -> {:ok, %{"version" => "0.3.0", "git_commit" => "abc"}} end,
      unit_contents: fn _ -> {:ok, "expected-unit"} end,
      expected_unit: fn _ -> "expected-unit" end,
      service: fn _ ->
        {:ok,
         %{
           "LoadState" => "loaded",
           "UnitFileState" => "enabled",
           "ActiveState" => "active",
           "SubState" => "running",
           "MainPID" => "42",
           "NRestarts" => "1",
           "Result" => "success"
         }}
      end,
      listener: fn _ -> {:owned, [42]} end,
      health: fn _, _ ->
        {:ok, %{"status" => "ok", "version" => "0.3.0", "git_commit" => "abc"}}
      end,
      linger: fn -> {:ok, false} end
    }

    assert {:ok, status} = Status.inspect(paths, host: "127.0.0.1", port: 4000, deps: deps)
    assert status.state == :healthy
    assert status.healthy?
    assert status.drift == []
    refute status.linger?
  end

  test "reports foreign listener and version drift independently" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})
    deps = healthy_deps("42")
    deps = %{deps | listener: fn _ -> {:owned, [99]} end}
    deps = %{deps | health: fn _, _ -> {:ok, %{"status" => "ok", "version" => "old"}} end}

    assert {:ok, status} = Status.inspect(paths, host: "127.0.0.1", port: 4000, deps: deps)
    assert status.state == :unhealthy
    assert :foreign_listener in status.drift
    assert :version in status.drift
  end

  defp healthy_deps(pid) do
    %{
      manifest: fn _ -> {:ok, %{"version" => "0.3.0", "git_commit" => "abc"}} end,
      unit_contents: fn _ -> {:ok, "expected-unit"} end,
      expected_unit: fn _ -> "expected-unit" end,
      service: fn _ ->
        {:ok,
         %{
           "LoadState" => "loaded",
           "UnitFileState" => "enabled",
           "ActiveState" => "active",
           "SubState" => "running",
           "MainPID" => pid,
           "NRestarts" => "0",
           "Result" => "success"
         }}
      end,
      listener: fn _ -> {:owned, [String.to_integer(pid)]} end,
      health: fn _, _ -> {:ok, %{"status" => "ok", "version" => "0.3.0", "git_commit" => "abc"}} end,
      linger: fn -> {:ok, true} end
    }
  end
end
```

Write preflight tests with injected dependencies:

```elixir
test "missing acknowledgement is a non-restartable error" do
  assert {:error, message} =
           Preflight.run(
             env: %{"HOME" => "/home/alice"},
             deps: permissive_deps()
           )

  assert message =~ "guardrails"
end

test "foreign port ownership fails without killing the process" do
  deps = %{permissive_deps() | listener: fn _ -> {:owned, [999]} end}

  assert {:error, message} =
           Preflight.run(
             env: acknowledged_env(),
             service_pid: nil,
             deps: deps
           )

  assert message =~ "port 4000"
  assert message =~ "999"
end

defp acknowledged_env do
  %{
    "HOME" => "/home/alice",
    "SYMPHONY_RUNTIME_MODE" => "installed",
    "SYMPHONY_UNGUARDED_ACKNOWLEDGED" => "true",
    "SYMPHONY_TRACKER_PORT" => "4000"
  }
end

defp permissive_deps do
  %{
    os_type: fn -> {:unix, :linux} end,
    systemd_ready: fn -> true end,
    manifest_valid: fn -> true end,
    paths_writable: fn -> true end,
    env_mode: fn -> 0o600 end,
    database_valid: fn -> true end,
    agent_available: fn -> true end,
    listener: fn _port -> :free end,
    optional_warnings: fn -> [] end
  }
end
```

- [ ] **Step 2: Run tests and observe missing modules**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/health_probe_test.exs \
  test/symphony_elixir/daemon/preflight_test.exs \
  test/symphony_elixir/daemon/status_test.exs
```

Expected: FAIL.

- [ ] **Step 3: Implement the local HTTP probe**

```elixir
defmodule SymphonyElixir.Daemon.HealthProbe do
  @moduledoc "Small dependency-free HTTP probe for the local health endpoint."

  @spec get(String.t(), non_neg_integer(), timeout()) ::
          {:ok, map()} | {:error, term()}
  def get(host, port, timeout \\ 2_000) do
    address = String.to_charlist(host)
    options = [:binary, active: false, packet: :raw]

    with {:ok, socket} <- :gen_tcp.connect(address, port, options, timeout),
         :ok <-
           :gen_tcp.send(
             socket,
             "GET /api/health HTTP/1.1\r\nHost: #{host}\r\nConnection: close\r\n\r\n"
           ),
         {:ok, response} <- recv_all(socket, "", timeout) do
      :gen_tcp.close(socket)
      parse(response)
    end
  end

  @spec parse(String.t()) :: {:ok, map()} | {:error, term()}
  def parse(response) do
    with [head, body] <- String.split(response, "\r\n\r\n", parts: 2),
         [status_line | _] <- String.split(head, "\r\n"),
         {:ok, 200} <- status_code(status_line),
         {:ok, %{} = decoded} <- Jason.decode(body),
         "ok" <- decoded["status"] do
      {:ok, decoded}
    else
      {:ok, code} -> {:error, {:http_status, code}}
      _ -> {:error, :invalid_response}
    end
  end

  defp status_code(status_line) do
    case String.split(status_line, " ", parts: 3) do
      [_, status, _] ->
        case Integer.parse(status) do
          {code, ""} -> {:ok, code}
          _ -> {:error, :invalid_status}
        end

      _ ->
        {:error, :invalid_status}
    end
  end

  defp recv_all(socket, acc, timeout) do
    case :gen_tcp.recv(socket, 0, timeout) do
      {:ok, bytes} -> recv_all(socket, acc <> bytes, timeout)
      {:error, :closed} -> {:ok, acc}
      error -> error
    end
  end
end
```

- [ ] **Step 4: Implement status composition**

`Status.inspect/2` returns:

```elixir
%{
  state: :healthy | :unhealthy | :inactive | :uninstalled,
  installed?: boolean(),
  enabled?: boolean(),
  active?: boolean(),
  listening?: boolean(),
  healthy?: boolean(),
  main_pid: non_neg_integer() | nil,
  restart_count: non_neg_integer(),
  health: map() | nil,
  drift: [atom()],
  linger?: boolean(),
  service: map()
}
```

Implement one pure composition path using injected `deps`; default dependencies
call `Manifest.read/1`, `File.read/1`, `Unit.render/1`, `Systemd.show/2`,
`Listener.probe/2`, `HealthProbe.get/3`, and `Systemd.linger/2`. Drift rules are
exactly:

```elixir
unit_drift = installed_unit != expected_unit
listener_drift = listener_pids != [] and main_pid not in listener_pids
version_drift = health["version"] != manifest["version"]
commit_drift =
  health["git_commit"] not in [nil, "unknown"] and
    manifest["git_commit"] not in [nil, "unknown"] and
    health["git_commit"] != manifest["git_commit"]
```

Set `healthy?` only when active, listener PID matches, health status is `ok`,
and version/commit/unit drift are absent.

- [ ] **Step 5: Implement preflight with explicit failures**

`Preflight.run/1` merges the supplied dependency map over the runtime
dependencies, then validates in this order:

```elixir
port =
  env
  |> Map.get("SYMPHONY_TRACKER_PORT", "4000")
  |> String.to_integer()

listener = deps.listener.(port)
port_owned_by_service? =
  case listener do
    {:owned, pids} when is_integer(service_pid) -> service_pid in pids
    _ -> false
  end

checks = [
  {:platform, deps.os_type.() == {:unix, :linux}},
  {:acknowledgement,
   env["SYMPHONY_UNGUARDED_ACKNOWLEDGED"] == "true"},
  {:systemd_user_manager, deps.systemd_ready.()},
  {:release_manifest, deps.manifest_valid.()},
  {:directories, deps.paths_writable.()},
  {:environment_mode, deps.env_mode.() == 0o600},
  {:database, deps.database_valid.()},
  {:agent_command, deps.agent_available.()},
  {:port, listener == :free or port_owned_by_service?}
]
```

Return `{:error, actionable_message}` for the first failed check and
`{:ok, deps.optional_warnings.()}` otherwise. Map check names to these exact
messages:

```elixir
%{
  platform: "Symphony daemon currently requires Linux",
  acknowledgement:
    "guardrails acknowledgement is required for the installed daemon",
  systemd_user_manager: "systemd user manager is unavailable",
  release_manifest: "release manifest is missing or invalid",
  directories: "daemon directories are not writable by the current user",
  environment_mode: "symphony.env must have mode 0600",
  database: "tracker database failed readability or integrity checks",
  agent_command: "configured default agent executable is unavailable",
  port: "port #{port} is already owned by #{inspect(listener)}"
}
```

Never invoke a kill or stop command.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/health_probe_test.exs \
  test/symphony_elixir/daemon/preflight_test.exs \
  test/symphony_elixir/daemon/status_test.exs
mix specs.check
```

Expected: PASS.

```bash
git add elixir/lib/symphony_elixir/daemon/{health_probe,preflight,status}.ex \
  elixir/test/symphony_elixir/daemon/{health_probe,preflight,status}_test.exs
git commit -m "feat(daemon): report health and configuration drift"
```

---

### Task 7: Idempotent lifecycle and operator CLI

**Files:**
- Create: `elixir/lib/symphony_elixir/daemon/lifecycle.ex`
- Create: `elixir/lib/symphony_elixir/daemon/cli.ex`
- Create: `elixir/lib/mix/tasks/symphony.daemon.ex`
- Modify: `elixir/lib/symphony_elixir/cli.ex`
- Test: `elixir/test/symphony_elixir/daemon/lifecycle_test.exs`
- Test: `elixir/test/symphony_elixir/daemon/cli_test.exs`
- Test: `elixir/test/mix/tasks/symphony_daemon_test.exs`

- [ ] **Step 1: Write failing parser and lifecycle tests**

```elixir
test "parses every supported command and option" do
  assert {:ok, {:status, %{json: true}}} = CLI.parse(["daemon", "status", "--json"])
  assert {:ok, {:restart, %{force: true}}} = CLI.parse(["daemon", "restart", "--force"])

  assert {:ok,
          {:install,
           %{
             artifact: "/tmp/symphony.tgz",
             migrate_from: "/repo/elixir",
             force: true,
             enable_linger: true,
             acknowledged: true
           }}} =
           CLI.parse([
             "daemon",
             "install",
             "--artifact",
             "/tmp/symphony.tgz",
             "--migrate-from",
             "/repo/elixir",
             "--force",
             "--enable-linger",
             "--i-understand-that-this-will-be-running-without-the-usual-guardrails"
           ])
end

test "rejects unknown or cross-command flags" do
  assert {:error, message} = CLI.parse(["daemon", "status", "--force"])
  assert message =~ "Usage:"
end
```

```elixir
test "start is idempotent when already healthy" do
  deps = %{
    status: fn -> {:ok, %{state: :healthy}} end,
    systemd_start: fn -> flunk("must not start an already healthy service") end,
    wait_healthy: fn -> flunk("must not wait") end
  }

  assert {:ok, :already_healthy} = Lifecycle.start(deps: deps)
end

test "forced restart kills the cgroup and waits for health" do
  test_pid = self()

  deps = %{
    force_restart: fn -> send(test_pid, :killed); :ok end,
    restart: fn -> flunk("ordinary restart must not run") end,
    wait_healthy: fn -> send(test_pid, :healthy); {:ok, %{state: :healthy}} end
  }

  assert {:ok, %{state: :healthy}} = Lifecycle.restart(force: true, deps: deps)
  assert_received :killed
  assert_received :healthy
end
```

- [ ] **Step 2: Run tests and observe missing modules**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/lifecycle_test.exs \
  test/symphony_elixir/daemon/cli_test.exs \
  test/mix/tasks/symphony_daemon_test.exs
```

Expected: FAIL.

- [ ] **Step 3: Implement lifecycle operations**

Implement:

```elixir
@spec start(keyword()) :: {:ok, term()} | {:error, term()}
def start(opts \\ []) do
  deps = deps(opts)

  case deps.status.() do
    {:ok, %{state: :healthy}} -> {:ok, :already_healthy}
    {:ok, %{state: :uninstalled}} -> {:error, :not_installed}
    _ ->
      with :ok <- deps.systemd_start.(),
           {:ok, status} <- deps.wait_healthy.() do
        {:ok, status}
      end
  end
end

@spec stop(keyword()) :: :ok | {:error, term()}
def stop(opts \\ []) do
  deps = deps(opts)

  case deps.status.() do
    {:ok, %{active?: false}} -> :ok
    {:ok, %{state: :uninstalled}} -> :ok
    _ -> deps.systemd_stop.()
  end
end

@spec restart(keyword()) :: {:ok, term()} | {:error, term()}
def restart(opts \\ []) do
  deps = deps(opts)
  action = if Keyword.get(opts, :force, false), do: deps.force_restart, else: deps.restart

  with :ok <- action.(),
       {:ok, status} <- deps.wait_healthy.() do
    {:ok, status}
  end
end

@spec status(keyword()) :: {:ok, map()} | {:error, term()}
def status(opts \\ []), do: deps(opts).status.()
```

The default `wait_healthy` polls `Status.inspect/2` every 250 ms for 30 seconds,
returns immediately on `:healthy`, and returns
`{:error, {:health_timeout, last_status}}` at the deadline.

- [ ] **Step 4: Implement CLI parsing and output**

`CLI.parse/1` uses strict `OptionParser` switches per command. `CLI.run/2`
returns:

```elixir
{:ok, %{exit_code: 0, output: String.t()}}
| {:error, %{exit_code: 1 | 2 | 78, output: String.t()}}
```

Rules:

- `status --json` prints `Jason.encode!/1`;
- healthy status exits `0`;
- stopped/unhealthy/drifted status exits `1`;
- invalid CLI usage exits `2`;
- preflight configuration errors exit `78`;
- no output includes environment values.

`CLI.main/1` prints to stdout/stderr and calls `System.halt/1`. The Mix task calls
`CLI.run/1` and uses `Mix.raise/1` only for nonzero results. Add this dispatch
before the existing escript runtime path:

```elixir
@spec main([String.t()]) :: no_return()
def main(["daemon" | rest]) do
  SymphonyElixir.Daemon.CLI.main(["daemon" | rest])
end
```

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/lifecycle_test.exs \
  test/symphony_elixir/daemon/cli_test.exs \
  test/mix/tasks/symphony_daemon_test.exs
mix specs.check
```

Expected: PASS.

```bash
git add elixir/lib/symphony_elixir/daemon/{lifecycle,cli}.ex \
  elixir/lib/mix/tasks/symphony.daemon.ex \
  elixir/lib/symphony_elixir/cli.ex \
  elixir/test/symphony_elixir/daemon/{lifecycle,cli}_test.exs \
  elixir/test/mix/tasks/symphony_daemon_test.exs
git commit -m "feat(daemon): add lifecycle management CLI"
```

---

### Task 8: Safe SQLite migration

**Files:**
- Create: `elixir/lib/symphony_elixir/daemon/migration.ex`
- Test: `elixir/test/symphony_elixir/daemon/migration_test.exs`

- [ ] **Step 1: Write failing migration tests using a WAL fixture**

```elixir
test "migrates a consistent database while preserving the source" do
  root = tmp_root()
  source = Path.join(root, "source.sqlite3")
  destination = Path.join(root, "data/tracker.sqlite3")
  backups = Path.join(root, "data/backups")
  create_fixture(source, "alpha")
  source_hash = sha256(source)

  assert {:ok, result} =
           Migration.migrate(source, destination,
             backup_dir: backups,
             dev_daemon_running?: fn -> false end,
             migrate: fn path ->
               assert path == destination
               :ok
             end
           )

  assert result.source_sha256 == source_hash
  assert sha256(source) == source_hash
  assert query_value(destination, "SELECT value FROM migration_fixture") == "alpha"
  assert Migration.integrity(destination) == :ok
end

test "refuses a live development owner before reading the database" do
  assert {:error, :development_daemon_running} =
           Migration.migrate("/missing/source", "/missing/dest",
             backup_dir: "/missing/backups",
             dev_daemon_running?: fn -> true end
           )
end

test "force backs up an existing destination before replacement" do
  root = tmp_root()
  source = Path.join(root, "source.sqlite3")
  destination = Path.join(root, "tracker.sqlite3")
  backups = Path.join(root, "backups")
  create_fixture(source, "new")
  create_fixture(destination, "old")

  assert {:ok, result} =
           Migration.migrate(source, destination,
             backup_dir: backups,
             force: true,
             dev_daemon_running?: fn -> false end,
             migrate: fn _ -> :ok end
           )

  assert File.exists?(result.previous_backup)
  assert query_value(result.previous_backup, "SELECT value FROM migration_fixture") == "old"
  assert query_value(destination, "SELECT value FROM migration_fixture") == "new"
end

defp tmp_root do
  root =
    Path.join(
      System.tmp_dir!(),
      "daemon-migration-#{System.unique_integer([:positive, :monotonic])}"
    )

  File.mkdir_p!(root)
  on_exit(fn -> File.rm_rf!(root) end)
  root
end

defp create_fixture(path, value) do
  File.mkdir_p!(Path.dirname(path))
  {:ok, db} = Exqlite.Sqlite3.open(path)
  :ok = Exqlite.Sqlite3.execute(db, "PRAGMA journal_mode=WAL")
  :ok =
    Exqlite.Sqlite3.execute(
      db,
      "CREATE TABLE migration_fixture (value TEXT NOT NULL)"
    )

  {:ok, statement} =
    Exqlite.Sqlite3.prepare(
      db,
      "INSERT INTO migration_fixture(value) VALUES (?)"
    )

  :ok = Exqlite.Sqlite3.bind(statement, [value])
  :done = Exqlite.Sqlite3.step(db, statement)
  :ok = Exqlite.Sqlite3.release(db, statement)
  :ok = Exqlite.Sqlite3.close(db)
end

defp query_value(path, sql) do
  {:ok, db} = Exqlite.Sqlite3.open(path, mode: :readonly)
  {:ok, statement} = Exqlite.Sqlite3.prepare(db, sql)
  {:row, [value]} = Exqlite.Sqlite3.step(db, statement)
  :ok = Exqlite.Sqlite3.release(db, statement)
  :ok = Exqlite.Sqlite3.close(db)
  value
end

defp sha256(path) do
  path
  |> File.read!()
  |> then(&:crypto.hash(:sha256, &1))
  |> Base.encode16(case: :lower)
end
```

The fixture helper opens Exqlite, enables WAL, creates one table, inserts the
value, and closes the connection.

- [ ] **Step 2: Run the test and observe missing module**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/migration_test.exs
```

Expected: FAIL.

- [ ] **Step 3: Implement consistent snapshot and integrity check**

Use Exqlite serialization so WAL content is included without relying on an
external `sqlite3` executable:

```elixir
@spec snapshot(Path.t(), Path.t()) :: :ok | {:error, term()}
def snapshot(source, destination) do
  temp = destination <> ".tmp.#{System.unique_integer([:positive, :monotonic])}"
  :ok = File.mkdir_p(Path.dirname(destination))

  with {:ok, db} <- Exqlite.Sqlite3.open(source, mode: :readonly),
       {:ok, binary} <- Exqlite.Sqlite3.serialize(db),
       :ok <- Exqlite.Sqlite3.close(db),
       :ok <- write_synced(temp, binary),
       :ok <- integrity(temp),
       :ok <- File.rename(temp, destination) do
    :ok
  else
    {:error, _reason} = error ->
      File.rm(temp)
      error
  end
end

@spec integrity(Path.t()) :: :ok | {:error, term()}
def integrity(path) do
  with {:ok, db} <- Exqlite.Sqlite3.open(path, mode: :readonly),
       {:ok, statement} <- Exqlite.Sqlite3.prepare(db, "PRAGMA integrity_check"),
       {:row, ["ok"]} <- Exqlite.Sqlite3.step(db, statement),
       :ok <- Exqlite.Sqlite3.release(db, statement),
       :ok <- Exqlite.Sqlite3.close(db) do
    :ok
  else
    other -> {:error, {:integrity_check_failed, other}}
  end
end
```

`write_synced/2` opens `[:write, :binary, :exclusive]`, writes the bytes,
calls `:file.sync/1`, and closes the file.

- [ ] **Step 4: Implement migration orchestration and Ecto release migration**

`Migration.migrate/3` must:

1. return `:development_daemon_running` first;
2. require the source to exist;
3. reject an existing destination unless `force: true`;
4. snapshot an existing destination to
   `<backup_dir>/pre_install_<UTC timestamp>.sqlite3`;
5. snapshot source to a same-directory temporary destination;
6. atomically activate it;
7. call the injected migration function;
8. integrity-check the migrated destination;
9. compare source SHA-256 before/after; and
10. return source/destination hashes and the optional backup path.

Add:

```elixir
@spec migrate_release(Path.t()) :: :ok | {:error, term()}
def migrate_release(database) do
  previous_repo =
    Application.get_env(:symphony_elixir, SymphonyElixir.Repo, [])

  Application.put_env(
    :symphony_elixir,
    SymphonyElixir.Repo,
    Keyword.put(previous_repo, :database, database)
  )

  Application.put_env(:symphony_elixir, :local_tracker_database_pinned?, true)

  case Ecto.Migrator.with_repo(SymphonyElixir.Repo, fn repo ->
         Ecto.Migrator.run(repo, :up, all: true)
       end) do
    {:ok, _versions, _apps} -> :ok
    {:error, reason} -> {:error, reason}
  end
end
```

- [ ] **Step 5: Run migration tests and commit**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/migration_test.exs
mix specs.check
```

Expected: PASS.

```bash
git add elixir/lib/symphony_elixir/daemon/migration.ex \
  elixir/test/symphony_elixir/daemon/migration_test.exs
git commit -m "feat(daemon): migrate SQLite state safely"
```

---

### Task 9: Safe artifact staging, install, repair, rollback, and uninstall

**Files:**
- Create: `elixir/lib/symphony_elixir/daemon/artifact.ex`
- Create: `elixir/lib/symphony_elixir/daemon/install.ex`
- Modify: `elixir/lib/symphony_elixir/daemon/lifecycle.ex`
- Modify: `elixir/lib/symphony_elixir/daemon/cli.ex`
- Test: `elixir/test/symphony_elixir/daemon/artifact_test.exs`
- Test: `elixir/test/symphony_elixir/daemon/install_test.exs`
- Test: `elixir/test/symphony_elixir/daemon/lifecycle_test.exs`

- [ ] **Step 1: Write failing archive safety and rollback tests**

```elixir
test "rejects absolute and parent-traversal tar entries" do
  assert {:error, :unsafe_archive_path} =
           Artifact.validate_entries([~c"../escape", ~c"bin/symphony"])

  assert {:error, :unsafe_archive_path} =
           Artifact.validate_entries([~c"/tmp/escape"])

  assert :ok =
           Artifact.validate_entries([
             ~c"bin/symphony",
             ~c"manifest.json",
             ~c"lib/app/ebin/app.beam"
           ])
end
```

```elixir
test "failed candidate health restores the previous release and unit" do
  root = tmp_installation()
  previous = Path.join(root.paths.releases_dir, "0.2.0")
  candidate = Path.join(root.paths.releases_dir, "0.3.0")
  File.mkdir_p!(previous)
  File.mkdir_p!(candidate)
  Files.atomic_symlink(previous, root.paths.current_link)
  Files.atomic_write(root.paths.unit_file, "old-unit", 0o644)
  test_pid = self()

  deps = %{
    stage: fn _artifact, _paths -> {:ok, candidate_info(candidate, "0.3.0")} end,
    migrate: fn _opts -> {:ok, %{}} end,
    write_environment: fn _ -> :ok end,
    write_launcher: fn _ -> :ok end,
    write_unit: fn _ -> Files.atomic_write(root.paths.unit_file, "new-unit", 0o644) end,
    daemon_reload: fn -> :ok end,
    enable_or_restart: fn -> send(test_pid, :candidate_started); :ok end,
    wait_healthy: fn ->
      if File.read_link!(root.paths.current_link) == candidate,
        do: {:error, :candidate_unhealthy},
        else: {:ok, %{state: :healthy}}
    end
  }

  assert {:error, {:install_failed, :candidate_unhealthy}} =
           Install.run("/tmp/candidate.tgz",
             paths: root.paths,
             force: true,
             deps: deps
           )

  assert File.read_link!(root.paths.current_link) == previous
  assert File.read!(root.paths.unit_file) == "old-unit"
  assert_received :candidate_started
end

test "first install reports success only after health" do
  root = tmp_installation()
  test_pid = self()
  deps = successful_deps(root, test_pid)

  assert {:ok, %{version: "0.3.0"}} =
           Install.run("/tmp/candidate.tgz", paths: root.paths, deps: deps)

  assert_received :health_checked
end

defp tmp_installation do
  root =
    Path.join(
      System.tmp_dir!(),
      "daemon-install-#{System.unique_integer([:positive, :monotonic])}"
    )

  paths =
    Paths.resolve(%{
      "HOME" => Path.join(root, "home"),
      "XDG_CONFIG_HOME" => Path.join(root, "config"),
      "XDG_DATA_HOME" => Path.join(root, "data"),
      "XDG_STATE_HOME" => Path.join(root, "state"),
      "SYMPHONY_INSTALL_ROOT" => Path.join(root, "lib/symphony")
    })

  on_exit(fn -> File.rm_rf!(root) end)
  %{root: root, paths: paths}
end

defp candidate_info(path, version) do
  %{
    path: path,
    version: version,
    git_commit: "candidate-commit",
    artifact_sha256: String.duplicate("a", 64),
    manifest: %{
      "version" => version,
      "git_commit" => "candidate-commit",
      "system_architecture" =>
        :erlang.system_info(:system_architecture) |> to_string()
    }
  }
end

defp successful_deps(root, test_pid) do
  candidate = Path.join(root.paths.releases_dir, "0.3.0")
  File.mkdir_p!(candidate)

  %{
    stage: fn _artifact, _paths ->
      {:ok, candidate_info(candidate, "0.3.0")}
    end,
    migrate: fn _opts -> {:ok, %{source_sha256: nil}} end,
    write_environment: fn _candidate ->
      Files.atomic_write(root.paths.env_file, "SYMPHONY_RUNTIME_MODE=\"installed\"\n", 0o600)
    end,
    write_launcher: fn _candidate ->
      Files.atomic_write(root.paths.launcher, "#!/bin/sh\nexit 0\n", 0o755)
    end,
    write_unit: fn _candidate ->
      Files.atomic_write(root.paths.unit_file, "unit", 0o644)
    end,
    daemon_reload: fn -> :ok end,
    enable_or_restart: fn -> :ok end,
    wait_healthy: fn ->
      send(test_pid, :health_checked)
      {:ok, %{state: :healthy}}
    end
  }
end
```

- [ ] **Step 2: Run tests and observe missing modules**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/artifact_test.exs \
  test/symphony_elixir/daemon/install_test.exs
```

Expected: FAIL.

- [ ] **Step 3: Implement safe tar staging**

`Artifact.stage/2` must:

1. call `:erl_tar.table(archive, [:compressed])`;
2. reject absolute paths, `..` path segments, NUL bytes, and empty names;
3. extract into `<releases_dir>/.staging-<unique>`;
4. locate exactly one `manifest.json`;
5. require non-empty `version`, `git_commit`, and `system_architecture`;
6. require the architecture to equal
   `:erlang.system_info(:system_architecture)`;
7. move the extracted release root to `<releases_dir>/<version>`;
8. compute the archive SHA-256; and
9. return `%{path:, version:, git_commit:, artifact_sha256:, manifest:}`.

Use:

```elixir
@spec validate_entries([charlist()]) :: :ok | {:error, :unsafe_archive_path}
def validate_entries(entries) do
  safe? =
    Enum.all?(entries, fn entry ->
      path = to_string(entry)
      segments = Path.split(path)

      path != "" and not Path.type(path) == :absolute and
        ".." not in segments and not String.contains?(path, "\0")
    end)

  if safe?, do: :ok, else: {:error, :unsafe_archive_path}
end
```

- [ ] **Step 4: Implement installation transaction**

`Install.run/2` must capture before mutation:

```elixir
previous = %{
  link: read_link_or_nil(paths.current_link),
  unit: read_file_or_nil(paths.unit_file),
  launcher: read_file_or_nil(paths.launcher),
  manifest: read_file_or_nil(paths.install_manifest)
}
```

Then execute:

```elixir
with {:ok, candidate} <- deps.stage.(artifact, paths),
     :ok <- validate_same_version(candidate, previous, force?),
     {:ok, migration} <- deps.migrate.(opts),
     :ok <- deps.write_environment.(candidate),
     :ok <- deps.write_launcher.(candidate),
     :ok <- deps.write_unit.(candidate),
     :ok <- deps.daemon_reload.(),
     :ok <- Files.atomic_symlink(candidate.path, paths.current_link),
     :ok <- deps.enable_or_restart.(),
     {:ok, _status} <- deps.wait_healthy.(),
     :ok <- write_install_manifest(paths, candidate, migration) do
  {:ok, %{version: candidate.version, path: candidate.path}}
else
  {:error, reason} ->
    rollback(previous, paths, deps)
    {:error, {:install_failed, reason}}
end
```

The generated environment includes:

```elixir
%{
  "HOME" => paths.home,
  "PATH" => source_env["PATH"],
  "LANG" => source_env["LANG"] || "C.UTF-8",
  "SYMPHONY_RUNTIME_MODE" => "installed",
  "SYMPHONY_UNGUARDED_ACKNOWLEDGED" => "true",
  "SYMPHONY_INSTALL_ROOT" => paths.install_root,
  "SYMPHONY_LOCAL_TRACKER_DATABASE" => paths.database,
  "SYMPHONY_BACKUP_DIR" => paths.backup_dir,
  "SYMPHONY_BUILD_COMMIT" => candidate.git_commit
}
```

Merge only source keys allowed by `Environment.render/1`. Write the global
launcher as:

```sh
#!/bin/sh
set -eu
install_root="${SYMPHONY_INSTALL_ROOT:-$HOME/.local/lib/symphony}"
exec "$install_root/current/bin/symphony-daemon" "$@"
```

Use mode `0755`.

- [ ] **Step 5: Add uninstall without persistent-data deletion**

Add `Lifecycle.uninstall/1`:

```elixir
@spec uninstall(keyword()) :: :ok | {:error, term()}
def uninstall(opts \\ []) do
  deps = deps(opts)

  with :ok <- deps.disable_now.(),
       :ok <- remove_if_present(deps.unit_file),
       :ok <- remove_if_present(deps.launcher),
       :ok <- remove_if_present(deps.current_link),
       :ok <- deps.daemon_reload.() do
    :ok
  end
end
```

Tests must assert that environment, install manifest, database, backups, logs,
and versioned releases still exist.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/artifact_test.exs \
  test/symphony_elixir/daemon/install_test.exs \
  test/symphony_elixir/daemon/lifecycle_test.exs \
  test/symphony_elixir/daemon/cli_test.exs
mix specs.check
```

Expected: PASS.

```bash
git add elixir/lib/symphony_elixir/daemon/{artifact,install,lifecycle,cli}.ex \
  elixir/test/symphony_elixir/daemon/{artifact,install,lifecycle,cli}_test.exs
git commit -m "feat(daemon): install releases with health rollback"
```

---

### Task 10: Graceful admission close and five-minute OTP drain

**Files:**
- Create: `elixir/lib/symphony_elixir/daemon/shutdown.ex`
- Modify: `elixir/lib/symphony_elixir/shared_supervisor.ex`
- Modify: `elixir/lib/symphony_elixir.ex`
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/turn_manager.ex`
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Modify: `elixir/lib/symphony_elixir/gateways/router.ex`
- Test: `elixir/test/symphony_elixir/daemon/shutdown_test.exs`
- Test: `elixir/test/symphony_elixir/assistant/turn_manager_test.exs`
- Test: `elixir/test/symphony_elixir/orchestrator_status_test.exs`

- [ ] **Step 1: Write failing gate and drain tests**

```elixir
test "begin_drain closes admission immediately" do
  name = Module.concat(__MODULE__, :Gate)
  start_supervised!({Shutdown, name: name})

  assert Shutdown.admitting?(name)
  assert :ok = Shutdown.begin_drain(name)
  refute Shutdown.admitting?(name)
end

test "drain waits for active work to reach zero" do
  snapshots = Agent.start_link(fn -> [%{assistant: [1], issues: ["SYM-1"]}, %{assistant: [], issues: []}] end)
  {:ok, agent} = snapshots

  work = fn ->
    Agent.get_and_update(agent, fn [head | tail] ->
      {head, if(tail == [], do: [head], else: tail)}
    end)
  end

  assert {:ok, %{assistant: [], issues: []}} =
           Shutdown.drain(100,
             begin_drain: fn -> :ok end,
             work_snapshot: work,
             sleep: fn _ -> :ok end,
             monotonic_ms: monotonic_sequence([0, 10])
           )
end

test "drain timeout interrupts assistant work once" do
  test_pid = self()

  assert {:timeout, %{assistant: [7], issues: ["SYM-7"]}} =
           Shutdown.drain(5,
             begin_drain: fn -> :ok end,
             work_snapshot: fn -> %{assistant: [7], issues: ["SYM-7"]} end,
             interrupt_assistants: fn ids, reason ->
               send(test_pid, {:interrupted, ids, reason})
               :ok
             end,
             sleep: fn _ -> :ok end,
             monotonic_ms: monotonic_sequence([0, 6])
           )

  assert_received {:interrupted, [7], "daemon_shutdown_timeout"}
end

defp monotonic_sequence(values) do
  {:ok, agent} = Agent.start_link(fn -> values end)

  fn ->
    Agent.get_and_update(agent, fn
      [value] -> {value, [value]}
      [value | rest] -> {value, rest}
    end)
  end
end
```

Add TurnManager tests:

```elixir
test "start and enqueue reject work while daemon is draining", %{thread: thread} do
  :ok = Shutdown.begin_drain()

  assert {:error, :daemon_draining} =
           TurnManager.start_turn(thread.id, "new", run: fn -> {:ok, %{}} end)

  assert {:error, :daemon_draining} =
           TurnManager.enqueue(thread.id, "queued", run: fn -> {:ok, %{}} end)
end

test "active_thread_ids and interrupt_all expose running workers", %{thread: thread} do
  test_pid = self()

  run = fn ->
    send(test_pid, {:worker, self()})
    receive do: ({:agent_interrupt} -> {:error, :interrupted})
  end

  assert {:ok, %{pid: worker}} = TurnManager.start_turn(thread.id, "live", run: run)
  assert_receive {:worker, ^worker}
  assert thread.id in TurnManager.active_thread_ids()
  assert :ok = TurnManager.interrupt_all("daemon_shutdown_timeout")
end
```

Reset `Shutdown` to admitting in test setup/on-exit.

- [ ] **Step 2: Run focused tests and observe failures**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/shutdown_test.exs \
  test/symphony_elixir/assistant/turn_manager_test.exs
```

Expected: FAIL.

- [ ] **Step 3: Implement the gate and drain coordinator**

```elixir
defmodule SymphonyElixir.Daemon.Shutdown do
  @moduledoc "Admission gate and bounded active-work drain."

  use GenServer

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, :admitting, name: name)
  end

  @spec admitting?(GenServer.server()) :: boolean()
  def admitting?(server \\ __MODULE__) do
    GenServer.call(server, :admitting?)
  catch
    :exit, _ -> true
  end

  @spec begin_drain(GenServer.server()) :: :ok
  def begin_drain(server \\ __MODULE__) do
    GenServer.call(server, :begin_drain)
  end

  @spec reset(GenServer.server()) :: :ok
  def reset(server \\ __MODULE__) do
    GenServer.call(server, :reset)
  end

  @spec drain(non_neg_integer(), keyword()) ::
          {:ok, map()} | {:timeout, map()}
  def drain(timeout_ms, opts \\ []) do
    begin_fun = Keyword.get(opts, :begin_drain, &begin_drain/0)
    snapshot_fun = Keyword.get(opts, :work_snapshot, &work_snapshot/0)
    interrupt_fun =
      Keyword.get(opts, :interrupt_assistants, &interrupt_assistants/2)
    sleep_fun = Keyword.get(opts, :sleep, &Process.sleep/1)
    monotonic = Keyword.get(opts, :monotonic_ms, fn -> System.monotonic_time(:millisecond) end)

    :ok = begin_fun.()
    deadline = monotonic.() + timeout_ms
    await(snapshot_fun, interrupt_fun, sleep_fun, monotonic, deadline)
  end

  @impl true
  def init(state), do: {:ok, state}

  @impl true
  def handle_call(:admitting?, _from, state), do: {:reply, state == :admitting, state}
  def handle_call(:begin_drain, _from, _state), do: {:reply, :ok, :draining}
  def handle_call(:reset, _from, _state), do: {:reply, :ok, :admitting}

  defp await(snapshot, interrupt, sleep, monotonic, deadline) do
    work = snapshot.()

    cond do
      work.assistant == [] and work.issues == [] ->
        {:ok, work}

      monotonic.() >= deadline ->
        :ok = interrupt.(work.assistant, "daemon_shutdown_timeout")
        {:timeout, work}

      true ->
        sleep.(250)
        await(snapshot, interrupt, sleep, monotonic, deadline)
    end
  end

  defp work_snapshot do
    issue_ids =
      case SymphonyElixir.Orchestrator.snapshot() do
        %{running: running} -> Enum.map(running, & &1.identifier)
        _ -> []
      end

    %{
      assistant: SymphonyElixir.Assistant.TurnManager.active_thread_ids(),
      issues: issue_ids
    }
  end

  defp interrupt_assistants(ids, reason) do
    SymphonyElixir.Assistant.TurnManager.interrupt_all(ids, reason)
  end
end
```

- [ ] **Step 4: Wire admission into assistant and issue dispatch**

Add `Shutdown` before `TurnManager` in `SharedSupervisor.child_specs/0`.

Change `TurnManager.enqueue/3` from cast to call and add:

```elixir
@spec active_thread_ids() :: [integer()]
def active_thread_ids do
  GenServer.call(__MODULE__, :active_thread_ids)
end

@spec interrupt_all(String.t()) :: :ok
def interrupt_all(reason) do
  interrupt_all(active_thread_ids(), reason)
end

@spec interrupt_all([integer()], String.t()) :: :ok
def interrupt_all(ids, reason) do
  Enum.each(ids, &interrupt(&1, reason))
  :ok
end
```

`start_turn` and `enqueue` return `{:error, :daemon_draining}` before mutation
when `Shutdown.admitting?/0` is false. `handle_call(:active_thread_ids, ...)`
extracts integer IDs from state keys matching `{:turn, id}`.

In `Orchestrator.maybe_dispatch/1`, return state immediately while draining.
In the manual `request_dispatch` handler, return
`{:error, :daemon_draining}`. Update assistant channel and gateway queue call
sites to return a visible retryable error when `TurnManager.enqueue/3` returns
that value.

- [ ] **Step 5: Drain only installed-mode OTP shutdown**

Add:

```elixir
@impl true
def prep_stop(state) do
  if SymphonyElixir.Daemon.BuildInfo.snapshot().mode == "installed" do
    _ = SymphonyElixir.Daemon.Shutdown.drain(300_000)
  end

  state
end
```

to `SymphonyElixir.Application`. Development `make stop` remains immediate.

- [ ] **Step 6: Run focused suites and commit**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/shutdown_test.exs \
  test/symphony_elixir/assistant/turn_manager_test.exs \
  test/symphony_elixir/orchestrator_status_test.exs \
  test/symphony_elixir_web/channels/assistant_channel_test.exs \
  test/symphony_elixir/gateways/router_test.exs
mix specs.check
```

Expected: PASS.

```bash
git add elixir/lib/symphony_elixir/daemon/shutdown.ex \
  elixir/lib/symphony_elixir.ex \
  elixir/lib/symphony_elixir/shared_supervisor.ex \
  elixir/lib/symphony_elixir/orchestrator.ex \
  elixir/lib/symphony_elixir/assistant/turn_manager.ex \
  elixir/lib/symphony_elixir_web/channels/assistant_channel.ex \
  elixir/lib/symphony_elixir/gateways/router.ex \
  elixir/test/symphony_elixir/daemon/shutdown_test.exs \
  elixir/test/symphony_elixir/assistant/turn_manager_test.exs \
  elixir/test/symphony_elixir/orchestrator_status_test.exs
git commit -m "feat(daemon): drain active work on shutdown"
```

---

### Task 11: Release bootstrap and checkout-independent smoke test

**Files:**
- Modify: `elixir/Makefile`
- Modify: `elixir/lib/mix/tasks/symphony.daemon.ex`
- Create: `elixir/test/release/installed_release_test.sh`
- Test: `elixir/test/symphony_elixir/daemon/release_smoke_test.exs`

- [ ] **Step 1: Write the failing smoke harness**

Create `test/release/installed_release_test.sh`:

```sh
#!/bin/sh
set -eu

release_root=$1
scratch=$2
port=$3

mkdir -p "$scratch/config" "$scratch/data" "$scratch/state"
export HOME="$scratch/home"
export XDG_CONFIG_HOME="$scratch/config"
export XDG_DATA_HOME="$scratch/data"
export XDG_STATE_HOME="$scratch/state"
export SYMPHONY_RUNTIME_MODE=installed
export SYMPHONY_UNGUARDED_ACKNOWLEDGED=true
export SYMPHONY_LOCAL_TRACKER_DATABASE="$scratch/data/symphony/tracker.sqlite3"
export SYMPHONY_BACKUP_DIR="$scratch/data/symphony/backups"
export SYMPHONY_TRACKER_HOST=127.0.0.1
export SYMPHONY_TRACKER_PORT="$port"
export SYMPHONY_BUILD_COMMIT=release-smoke
export SYMPHONY_EDITOR_ENABLED=false

"$release_root/bin/symphony" eval \
  'System.halt(case SymphonyElixir.Daemon.Migration.migrate_release(System.fetch_env!("SYMPHONY_LOCAL_TRACKER_DATABASE")) do :ok -> 0; _ -> 1 end)'

"$release_root/bin/symphony" start >"$scratch/release.log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT

attempt=0
while [ "$attempt" -lt 120 ]; do
  if response=$(curl -fsS "http://127.0.0.1:$port/api/health"); then
    printf '%s' "$response" | grep '"mode":"installed"' >/dev/null
    test -f "$SYMPHONY_LOCAL_TRACKER_DATABASE"
    test -f "$release_root/lib/symphony_elixir-0.3.0/priv/skills/superpowers/using-superpowers/SKILL.md"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 0.25
done

cat "$scratch/release.log"
exit 1
```

Create `test/symphony_elixir/daemon/release_smoke_test.exs`:

```elixir
defmodule SymphonyElixir.Daemon.ReleaseSmokeTest do
  use ExUnit.Case, async: false

  @tag timeout: 120_000
  test "production release boots with SQLite, assets, migrations, and skills" do
    release_root = Path.expand("_build/prod/rel/symphony")

    scratch =
      Path.join(
        System.tmp_dir!(),
        "symphony-release-smoke-#{System.unique_integer([:positive, :monotonic])}"
      )

    port = unused_port()
    on_exit(fn -> File.rm_rf!(scratch) end)

    {output, status} =
      System.cmd(
        "sh",
        [
          "test/release/installed_release_test.sh",
          release_root,
          scratch,
          Integer.to_string(port)
        ],
        stderr_to_stdout: true
      )

    assert status == 0, output
  end

  defp unused_port do
    {:ok, socket} =
      :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}])

    {:ok, port} = :inet.port(socket)
    :ok = :gen_tcp.close(socket)
    port
  end
end
```

- [ ] **Step 2: Run the smoke test and observe missing bootstrap behavior**

Run:

```bash
cd elixir
MIX_ENV=prod mix release symphony --overwrite
mix test test/symphony_elixir/daemon/release_smoke_test.exs
```

Expected: FAIL until release entrypoints, migrations, runtime paths, and assets
all work together.

- [ ] **Step 3: Add Make targets and automatic artifact selection**

Add:

```make
.PHONY: release release-smoke daemon-install daemon-status

release:
	MIX_ENV=prod SYMPHONY_BUILD_COMMIT="$$(git rev-parse HEAD)" \
		$(MIX) release symphony --overwrite

release-smoke: release
	$(MIX) test test/symphony_elixir/daemon/release_smoke_test.exs

daemon-install: release
	$(MIX) symphony.daemon install \
		--artifact "_build/prod/symphony-$$( $(MIX) run --no-start -e 'IO.write(Mix.Project.config()[:version])' ).tar.gz" \
		$(ARGS)

daemon-status:
	$(MIX) symphony.daemon status $(ARGS)
```

When `mix symphony.daemon install` has no `--artifact`, its bootstrap path runs
`MIX_ENV=prod mix release symphony --overwrite` with argv, resolves the tar
using `Mix.Project.config()[:version]`, then calls `Install.run/2`.

- [ ] **Step 4: Run release smoke outside the checkout**

Run:

```bash
cd elixir
make release-smoke
scratch="$(mktemp -d)"
tar -xzf "_build/prod/symphony-0.3.0.tar.gz" -C "$scratch"
cd "$scratch"
test ! -e mix.exs
test ! -e deps
test ! -e _build
```

The ExUnit smoke must already have booted this extracted release successfully.

- [ ] **Step 5: Commit**

```bash
git add elixir/Makefile elixir/lib/mix/tasks/symphony.daemon.ex \
  elixir/test/release/installed_release_test.sh \
  elixir/test/symphony_elixir/daemon/release_smoke_test.exs
git commit -m "test(daemon): prove checkout-independent release boot"
```

---

### Task 12: Operator docs, fake-systemd integration, real WSL acceptance, and approved gates

**Files:**
- Modify: `INSTALL.md`
- Modify: `elixir/README.md`
- Create: `elixir/test/symphony_elixir/daemon/systemd_integration_test.exs`
- Create: `elixir/scripts/daemon-acceptance.sh`

- [ ] **Step 1: Add a fake-systemd end-to-end test**

The test creates a temporary HOME/XDG tree and a fake command runner that stores
unit state in an Agent. Exercise:

```elixir
assert {:ok, %{version: "0.3.0"}} = Install.run(artifact, opts)
assert {:ok, %{state: :healthy}} = Lifecycle.status(deps: deps)
assert :ok = Lifecycle.stop(deps: deps)
assert {:ok, _} = Lifecycle.start(deps: deps)
assert {:ok, _} = Lifecycle.restart(deps: deps)
assert :ok = Lifecycle.uninstall(deps: deps)

assert File.exists?(paths.env_file)
assert File.exists?(paths.database)
assert File.dir?(paths.backup_dir)
assert File.dir?(paths.releases_dir)
refute File.exists?(paths.unit_file)
refute File.exists?(paths.current_link)
```

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon/systemd_integration_test.exs
```

Expected: PASS.

- [ ] **Step 2: Document the exact operator workflow**

`INSTALL.md` must contain:

```text
make daemon-install ARGS="--i-understand-that-this-will-be-running-without-the-usual-guardrails"
symphony daemon status
symphony daemon status --json
symphony daemon restart
symphony daemon restart --force
journalctl --user-unit symphony.service
symphony daemon uninstall
```

Document XDG paths, `--migrate-from`, `--enable-linger`, port conflicts,
environment-file permissions, rollback behavior, retained uninstall data, and
the fact that `make serve` remains the development daemon.

`elixir/README.md` must document release build/smoke commands and the separation
between source hot reload and installed service mode.

- [ ] **Step 3: Add an isolated real-systemd acceptance script**

`scripts/daemon-acceptance.sh` must:

1. create a temporary HOME-like XDG root;
2. set `SYMPHONY_DAEMON_UNIT=symphony-acceptance-<pid>.service`;
3. choose an unused loopback port;
4. install the built artifact with isolated database paths;
5. assert status healthy;
6. capture `NRestarts`;
7. send `systemctl --user kill --signal=SIGKILL` to only the test unit;
8. wait for health and assert `NRestarts` increased;
9. run ordinary restart;
10. uninstall;
11. assert database/config/releases remain; and
12. use a trap to disable/remove only the unique test unit on failure.

The script must refuse to run if the computed unit equals
`symphony.service`.

Use this implementation:

```sh
#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
elixir_root="$repo_root/elixir"
artifact="$elixir_root/_build/prod/symphony-0.3.0.tar.gz"
unit="symphony-acceptance-$$.service"
scratch=$(mktemp -d)
real_home=${HOME:?HOME is required}
launcher="$scratch/bin/symphony"

if [ "$unit" = "symphony.service" ]; then
  echo "refusing to use the canonical unit" >&2
  exit 2
fi

port=$(
  cd "$elixir_root"
  mise exec -- elixir -e '
    {:ok, socket} = :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}])
    {:ok, port} = :inet.port(socket)
    :ok = :gen_tcp.close(socket)
    IO.write(port)
  '
)

cleanup() {
  systemctl --user disable --now "$unit" >/dev/null 2>&1 || true
  rm -f "$real_home/.config/systemd/user/$unit"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT INT TERM

export XDG_DATA_HOME="$scratch/data"
export XDG_STATE_HOME="$scratch/state"
export SYMPHONY_CONFIG_DIR="$scratch/config/symphony"
export SYMPHONY_SYSTEMD_USER_DIR="$real_home/.config/systemd/user"
export SYMPHONY_LAUNCHER_PATH="$launcher"
export SYMPHONY_INSTALL_ROOT="$scratch/lib/symphony"
export SYMPHONY_DAEMON_UNIT="$unit"
export SYMPHONY_LOCAL_TRACKER_DATABASE="$scratch/data/symphony/tracker.sqlite3"
export SYMPHONY_BACKUP_DIR="$scratch/data/symphony/backups"
export SYMPHONY_TRACKER_HOST=127.0.0.1
export SYMPHONY_TRACKER_PORT="$port"
export SYMPHONY_EDITOR_ENABLED=false

cd "$elixir_root"
mise exec -- mix symphony.daemon install \
  --artifact "$artifact" \
  --i-understand-that-this-will-be-running-without-the-usual-guardrails

"$launcher" daemon status
before=$(systemctl --user show "$unit" --property=NRestarts --value)
systemctl --user kill --kill-whom=all --signal=SIGKILL "$unit"

attempt=0
while [ "$attempt" -lt 120 ]; do
  if "$launcher" daemon status >/dev/null 2>&1; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.25
done

after=$(systemctl --user show "$unit" --property=NRestarts --value)
test "$after" -gt "$before"
"$launcher" daemon restart
"$launcher" daemon status
"$launcher" daemon uninstall

test -f "$SYMPHONY_LOCAL_TRACKER_DATABASE"
test -f "$SYMPHONY_CONFIG_DIR/symphony.env"
test -d "$SYMPHONY_INSTALL_ROOT/releases"
```

The unique unit file lives under the real `~/.config/systemd/user/` lookup
directory, while its environment, database, state, and release paths remain
isolated under `scratch`.

Run:

```bash
cd elixir
make release
bash scripts/daemon-acceptance.sh
```

Expected: PASS on the current WSL user systemd manager without touching the
canonical service or development process.

- [ ] **Step 4: Run all targeted daemon tests**

Run:

```bash
cd elixir
mix test test/symphony_elixir/daemon \
  test/mix/tasks/symphony_daemon_test.exs \
  test/symphony_elixir_web/health_controller_test.exs \
  test/symphony_elixir/assistant/turn_manager_test.exs \
  test/symphony_elixir/orchestrator_status_test.exs
```

Expected: PASS.

- [ ] **Step 5: Run repository quality gates**

Run:

```bash
cd elixir
make all
mix specs.check
make release-smoke
```

Expected: format, Credo, tests with coverage, Dialyzer, public-spec validation,
and release smoke all PASS.

- [ ] **Step 6: Verify the diff and commit**

Run:

```bash
git diff --check
git status --short
```

Confirm only daemon implementation, tests, release templates, and documentation
are present.

```bash
git add INSTALL.md elixir/README.md \
  elixir/test/symphony_elixir/daemon/systemd_integration_test.exs \
  elixir/scripts/daemon-acceptance.sh
git commit -m "docs(daemon): document and validate service operations"
```

---

## Final Acceptance Checklist

- [ ] Artifact boots outside the checkout with bundled ERTS, Exqlite, assets,
  migrations, and skills.
- [ ] `systemd --user` owns foreground process restart and start-limit policy.
- [ ] Invalid preflight exits `78` and does not restart-loop.
- [ ] CLI install/start/stop/restart/status/uninstall are idempotent.
- [ ] Human and JSON status separate service, listener, health, and drift.
- [ ] SQLite migration preserves and verifies the source plus forced backup.
- [ ] Candidate health failure restores the prior release and unit.
- [ ] Ordinary shutdown closes admission and drains for up to five minutes.
- [ ] Forced restart produces honest interrupted/resumable assistant state.
- [ ] Uninstall preserves configuration, database, backups, logs, and releases.
- [ ] Development `make serve/update/stop` behavior remains unchanged.
- [ ] Real unique-unit SIGKILL acceptance proves systemd restart.
- [ ] Full repository gates and release smoke pass.
