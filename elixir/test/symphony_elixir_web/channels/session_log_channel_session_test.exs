defmodule SymphonyElixirWeb.SessionLogChannelSessionTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL
  alias SymphonyElixir.Agent.SessionStore
  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    SQL.query!(Repo, "DELETE FROM assistant_threads", [])

    socket = socket(SymphonyElixirWeb.UserSocket, nil, %{tracker_token_valid: true})
    {:ok, socket: socket}
  end

  test "join session_log:<session_id> resolves the session's own transcript", %{socket: socket} do
    workspace = Path.join(System.tmp_dir!(), "chan-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    {:ok, thread} =
      %Thread{}
      |> Thread.changeset(%{
        scope: "issue_execution",
        project_slug: "advising",
        issue_identifier: "CDE-1180",
        workspace_path: workspace,
        agent_kind: "codex",
        status: "active"
      })
      |> Repo.insert()

    :ok =
      SessionStore.append(workspace, thread.id, %{"type" => "assistant", "text" => "hello-session"})

    {:ok, reply, _socket} =
      subscribe_and_join(
        socket,
        SymphonyElixirWeb.SessionLogChannel,
        "session_log:#{thread.id}",
        %{"project_slug" => "advising"}
      )

    # The join resolved THIS session's own file (isolation), not a shared issue log.
    assert reply.path == SessionStore.transcript_path(workspace, thread.id)
    assert reply.agent_kind == "symphony"
  end

  test "legacy session_log:<project>:<issue> topic still routes to the per-issue path", %{
    socket: socket
  } do
    # Non-numeric topic must NOT be misread as a session id; it reaches the issue
    # path. With no native rollout on disk, that path reports unavailable (proving
    # it routed to join_by_issue rather than returning invalid_topic or crashing).
    result =
      subscribe_and_join(
        socket,
        SymphonyElixirWeb.SessionLogChannel,
        "session_log:advising:CDE-1180",
        %{"project_slug" => "advising"}
      )

    assert {:error, %{reason: "session_log_unavailable"}} = result
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
