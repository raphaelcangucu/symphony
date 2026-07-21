defmodule SymphonyElixirWeb.TerminalChannelThreadTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  defmodule FakeWorkspaceTmux do
    def available?, do: true

    def has_session?(session_name) do
      notify({:has_session, session_name})
      false
    end

    def new_session(session_name, cwd) do
      notify({:new_session, session_name, cwd})
      :ok
    end

    def capture_pane(session_name) do
      notify({:capture, session_name})
      {:ok, "thread workspace ready\n"}
    end

    def send_keys(session_name, data) do
      notify({:sent_keys, session_name, data})
      :ok
    end

    def resize(session_name, cols, rows) do
      notify({:resized, session_name, cols, rows})
      :ok
    end

    defp notify(message) do
      if pid = Process.whereis(__MODULE__.TestProcess), do: send(pid, message)
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    previous_tmux = Application.get_env(:symphony_elixir, :terminal_tmux)
    System.put_env(@token_env, "secret")
    Application.put_env(:symphony_elixir, :terminal_tmux, FakeWorkspaceTmux)
    Process.register(self(), FakeWorkspaceTmux.TestProcess)

    workspace_path =
      Path.join(
        System.tmp_dir!(),
        "symphony-terminal-thread-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(workspace_path)
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    {:ok, thread} =
      History.create_workspace_session_thread("macro-markets", workspace_path, %{
        title: "Standalone workspace"
      })

    on_exit(fn ->
      File.rm_rf!(workspace_path)
      restore_env(@token_env, previous_token)
      restore_app_env(:terminal_tmux, previous_tmux)
    end)

    {:ok, thread: thread, workspace_path: Path.expand(workspace_path)}
  end

  test "joins a thread terminal at its workspace and routes terminal events", %{
    thread: thread,
    workspace_path: workspace_path
  } do
    assert {:ok, %{session: session}, socket} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
             |> subscribe_and_join(
               SymphonyElixirWeb.TerminalChannel,
               "terminal:thread:#{thread.id}",
               %{"project_slug" => "macro-markets"}
             )

    assert session.project_slug == "macro-markets"
    assert session.issue_identifier == nil
    assert session.cwd == workspace_path
    assert socket.assigns.thread_id == thread.id
    assert socket.assigns.workspace_path == workspace_path

    push(socket, "input", %{"data" => "pwd\n"})
    assert_receive {:sent_keys, session_name, "pwd\n"}
    assert session_name == session.session_name
    assert_push("output", %{data: "thread workspace ready\n"})

    push(socket, "resize", %{"cols" => 132, "rows" => 42})
    assert_receive {:resized, ^session_name, 132, 42}
  end

  test "rejects a project payload that does not own the thread", %{thread: thread} do
    assert {:error, %{reason: "project_mismatch"}} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
             |> subscribe_and_join(
               SymphonyElixirWeb.TerminalChannel,
               "terminal:thread:#{thread.id}",
               %{"project_slug" => "other-project"}
             )
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "assistant_messages",
          "assistant_threads",
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_comments",
          "local_tracker_issue_labels",
          "local_tracker_issues",
          "local_tracker_labels",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)

  defp restore_app_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_app_env(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
