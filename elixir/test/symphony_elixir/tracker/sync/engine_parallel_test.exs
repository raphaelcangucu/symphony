defmodule SymphonyElixir.Tracker.Sync.EngineParallelTest do
  @moduledoc """
  Drives the engine's GenServer message paths (parallel per-project tasks,
  coalescing, per-project timeout/cancellation, crash handling and the targeted
  `request_sync_project/2`). Tasks run under `SymphonyElixir.TaskSupervisor`, so
  these tests start a transient engine instance and observe the shared sync state.
  """
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, Outbox, StateRecord}

  defmodule OkDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver
    @impl true
    def pull(_project, _opts), do: {:ok, []}
    @impl true
    def push(_project, _entry), do: {:ok, "REMOTE"}
    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  defmodule SlowDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver
    @impl true
    def pull(_project, _opts) do
      Process.sleep(300)
      {:ok, []}
    end

    @impl true
    def push(_project, _entry), do: {:ok, "REMOTE"}
    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  defmodule RaisingDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver
    @impl true
    def pull(_project, _opts), do: raise("boom from pull")
    @impl true
    def push(_project, _entry), do: {:ok, "REMOTE"}
    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  defmodule ErrorDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver
    @impl true
    def pull(_project, _opts), do: {:error, :boom}
    @impl true
    def push(_project, _entry), do: {:ok, "REMOTE"}
    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  defmodule StubGitHub do
    @behaviour SymphonyElixir.Tracker.IssueAdapter
    @impl true
    def kind, do: :github
    @impl true
    def list_issues(_project, _filters), do: {:ok, []}
    @impl true
    def get_issue(_project, _identifier), do: {:error, :issue_not_found}
    @impl true
    def create_issue(_project, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def update_issue(_project, _identifier, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def move_issue(_project, _identifier, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def list_statuses(_project), do: {:ok, []}
    @impl true
    def list_labels(_project), do: {:ok, []}
    @impl true
    def list_assignable_users(_project), do: {:ok, []}
    @impl true
    def list_comments(_project, _identifier), do: {:ok, []}
    @impl true
    def add_comment(_project, _identifier, _body, _attrs), do: {:error, :not_supported_on_remote}
    def update_comment(_project, _identifier, _comment_id, _body), do: {:error, :not_supported_on_remote}
    def delete_comment(_project, _identifier, _comment_id), do: {:error, :not_supported_on_remote}
  end

  setup do
    migrate_repo()
    clean_repo()

    prev_adapters = Application.get_env(:symphony_elixir, :issue_adapters)
    prev_tracker = Application.get_env(:symphony_elixir, :tracker)
    prev_timeout = Application.get_env(:symphony_elixir, :tracker_sync_project_timeout_ms)
    Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => StubGitHub})

    on_exit(fn ->
      restore(:issue_adapters, prev_adapters)
      restore(:tracker, prev_tracker)
      restore(:tracker_sync_project_timeout_ms, prev_timeout)
    end)

    {:ok, github} =
      Context.ensure_project(%{
        name: "GH",
        slug: "gh",
        tracker_kind: "github",
        tracker_config: %{"repo" => "acme/web", "project_id" => "PVT_1"}
      })

    {:ok, local} = Context.ensure_project(%{name: "Local", slug: "local"})

    %{github: github, local: local}
  end

  test "sync_all cast syncs each enabled project in its own task", %{github: github} do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    pid = start_engine(fn _project -> OkDriver end)

    GenServer.cast(pid, {:sync_all, []})

    assert_eventually(fn -> status(github.id) == "idle" end)
    assert :sys.get_state(pid).in_flight == %{}
  end

  test "sync_project cast pushes the project's outbox and pulls", %{github: github} do
    {:ok, _entry} =
      Outbox.enqueue(%{
        project_id: github.id,
        entity_type: "state",
        operation: "move",
        payload: %{"identifier" => "1", "state" => "Done"},
        dedup_key: "state:move:#{github.id}:1"
      })

    pid = start_engine(fn _project -> OkDriver end)

    GenServer.cast(pid, {:sync_project, "gh", []})

    assert_eventually(fn -> status(github.id) == "idle" end)
    assert Outbox.pending_count(github.id) == 0
  end

  test "sync_project cast is a no-op for a non-sync-enabled (local) project", %{local: local} do
    pid = start_engine(fn _project -> OkDriver end)

    GenServer.cast(pid, {:sync_project, "local", []})
    :sys.get_state(pid)

    assert is_nil(Repo.get_by(StateRecord, project_id: local.id))
    assert :sys.get_state(pid).in_flight == %{}
  end

  test "a project with no resolvable driver does not start a task", %{github: github} do
    pid = start_engine(fn _project -> nil end)

    GenServer.cast(pid, {:sync_project, "gh", []})
    :sys.get_state(pid)

    assert :sys.get_state(pid).in_flight == %{}
    assert is_nil(Repo.get_by(StateRecord, project_id: github.id))
  end

  test "a second request for an in-flight project is coalesced", %{github: github} do
    pid = start_engine(fn _project -> SlowDriver end)

    log =
      capture_log(fn ->
        GenServer.cast(pid, {:sync_project, "gh", []})
        GenServer.cast(pid, {:sync_project, "gh", []})
        # Both casts are processed while the first task is still sleeping in pull.
        assert map_size(:sys.get_state(pid).in_flight) == 1
        assert_eventually(fn -> status(github.id) == "idle" end)
      end)

    assert log =~ "coalesced"
  end

  test "a stuck project task is cancelled on timeout and marked errored", %{github: github} do
    Application.put_env(:symphony_elixir, :tracker_sync_project_timeout_ms, 20)
    pid = start_engine(fn _project -> SlowDriver end)

    log =
      capture_log(fn ->
        GenServer.cast(pid, {:sync_project, "gh", []})
        assert_eventually(fn -> status(github.id) == "error" end)
      end)

    state = Repo.get_by(StateRecord, project_id: github.id)
    assert state.last_error == "sync timeout"
    assert log =~ "timed out"
    assert :sys.get_state(pid).in_flight == %{}
  end

  test "a crashing project task marks the project errored", %{github: github} do
    pid = start_engine(fn _project -> RaisingDriver end)

    capture_log(fn ->
      GenServer.cast(pid, {:sync_project, "gh", []})
      assert_eventually(fn -> status(github.id) == "error" end)
    end)

    assert Repo.get_by(StateRecord, project_id: github.id).last_error =~ "crashed"
    assert :sys.get_state(pid).in_flight == %{}
  end

  test "a driver error marks the project errored without crashing the task", %{github: github} do
    pid = start_engine(fn _project -> ErrorDriver end)

    capture_log(fn ->
      GenServer.cast(pid, {:sync_project, "gh", []})
      assert_eventually(fn -> status(github.id) == "error" end)
    end)

    assert Repo.get_by(StateRecord, project_id: github.id).last_error =~ "boom"
  end

  test "unexpected messages are ignored without crashing the engine" do
    pid = start_engine(fn _project -> OkDriver end)

    send(pid, {make_ref(), :ok})
    send(pid, {:DOWN, make_ref(), :process, self(), :normal})
    send(pid, {:sync_timeout, make_ref()})
    send(pid, :a_random_message)

    assert %{in_flight: %{}} = :sys.get_state(pid)
    assert Process.alive?(pid)
  end

  test "request_sync_project casts to the running engine when sync is enabled" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)

    assert Engine.request_sync_project("does-not-exist", force: true) == :ok
    # Drain the global engine so the {:sync_project, ...} cast (unknown slug) is
    # handled and proven to be a no-op.
    :sys.get_state(Engine)
  end

  defp start_engine(driver_for) do
    name = :"engine_#{System.unique_integer([:positive])}"
    {:ok, pid} = Engine.start_link(name: name, driver_for: driver_for)
    on_exit(fn -> if Process.alive?(pid), do: GenServer.stop(pid) end)
    pid
  end

  defp status(project_id) do
    case Repo.get_by(StateRecord, project_id: project_id) do
      %StateRecord{status: status} -> status
      _ -> nil
    end
  end

  defp assert_eventually(fun, attempts \\ 200) do
    cond do
      fun.() -> :ok
      attempts <= 0 -> flunk("condition not met in time")
      true -> Process.sleep(10) && assert_eventually(fun, attempts - 1)
    end
  end

  defp restore(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore(key, value), do: Application.put_env(:symphony_elixir, key, value)

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
