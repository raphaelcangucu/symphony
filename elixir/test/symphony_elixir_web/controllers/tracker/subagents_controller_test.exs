defmodule SymphonyElixirWeb.Tracker.SubagentsControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias Ecto.Adapters.SQL
  alias SymphonyElixir.Agent.SessionTranscript
  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    SQL.query!(Repo, "DELETE FROM assistant_threads", [])
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    {:ok, _project} = Context.ensure_project(%{name: "Advising", slug: "advising"})

    on_exit(fn -> restore_env(@token_env, previous_token) end)

    {:ok, conn: authorize()}
  end

  test "GET subagents lists Claude children without leaking path", %{conn: conn} do
    {thread, _child_id, tool_use_id} = setup_claude_parent_with_child!()

    conn =
      get(
        conn,
        "/api/tracker/v1/projects/advising/workspaces/#{thread.id}/subagents?agent_kind=claude"
      )

    body = json_response(conn, 200)
    assert %{"subagents" => [entry]} = body
    assert entry["id"] == "a0b70422f9f999605"
    assert entry["agent_kind"] == "claude"
    assert entry["label"] == "Extract signatures"
    assert entry["role"] == "Explore"
    assert entry["nickname"] == nil
    assert entry["tool_use_id"] == tool_use_id
    refute Map.has_key?(entry, "path")
  end

  test "GET subagents filters by tool_use_id", %{conn: conn} do
    {thread, _child_id, tool_use_id} = setup_claude_parent_with_child!()

    conn =
      get(
        conn,
        "/api/tracker/v1/projects/advising/workspaces/#{thread.id}/subagents?agent_kind=claude&tool_use_id=#{tool_use_id}"
      )

    assert %{"subagents" => [entry]} = json_response(conn, 200)
    assert entry["tool_use_id"] == tool_use_id

    miss =
      get(
        conn,
        "/api/tracker/v1/projects/advising/workspaces/#{thread.id}/subagents?agent_kind=claude&tool_use_id=toolu_missing"
      )

    assert %{"subagents" => []} = json_response(miss, 200)
  end

  test "GET subagents returns 404 for a missing thread", %{conn: conn} do
    conn = get(conn, "/api/tracker/v1/projects/advising/workspaces/999999/subagents")

    assert %{"error" => %{"message" => message}} = json_response(conn, 404)
    assert is_binary(message)
  end

  defp setup_claude_parent_with_child! do
    workspace =
      Path.join(System.tmp_dir!(), "subagents-ctrl-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)

    parent_path = SessionTranscript.path(:claude, workspace)
    File.mkdir_p!(Path.dirname(parent_path))
    File.write!(parent_path, "{}\n")

    child_id = "a0b70422f9f999605"
    tool_use_id = "toolu_01VSiPZB53TmJvgurefWVUGB"
    subagents = Path.join(Path.rootname(parent_path), "subagents")
    File.mkdir_p!(subagents)
    File.write!(Path.join(subagents, "agent-#{child_id}.jsonl"), "{}\n")

    File.write!(
      Path.join(subagents, "agent-#{child_id}.meta.json"),
      Jason.encode!(%{
        "agentType" => "Explore",
        "description" => "Extract signatures",
        "toolUseId" => tool_use_id
      })
    )

    {:ok, thread} =
      %Thread{}
      |> Thread.changeset(%{
        scope: "issue_execution",
        project_slug: "advising",
        issue_identifier: "CDE-1180",
        workspace_path: workspace,
        agent_kind: "claude",
        status: "active"
      })
      |> Repo.insert()

    {thread, child_id, tool_use_id}
  end

  defp authorize do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
