defmodule SymphonyElixirWeb.SessionLogChannelAgentTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL
  alias SymphonyElixir.Agent.SessionStore
  alias SymphonyElixir.Agent.SessionTranscript
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

  test "join session_log:agent:<id> streams a Claude subagent log", %{socket: socket} do
    workspace = tmp_workspace!("claude-agent")
    parent_path = SessionTranscript.path(:claude, workspace)
    File.mkdir_p!(Path.dirname(parent_path))
    File.write!(parent_path, "{}\n")

    child_id = "a0b70422f9f999605"
    subagents = Path.join(Path.rootname(parent_path), "subagents")
    File.mkdir_p!(subagents)
    child_path = Path.join(subagents, "agent-#{child_id}.jsonl")

    File.write!(
      child_path,
      Jason.encode!(%{
        "type" => "assistant",
        "message" => %{
          "role" => "assistant",
          "content" => [%{"type" => "text", "text" => "hello-subagent"}]
        }
      }) <> "\n"
    )

    File.write!(
      Path.join(subagents, "agent-#{child_id}.meta.json"),
      Jason.encode!(%{
        "agentType" => "Explore",
        "description" => "Extract signatures",
        "toolUseId" => "toolu_01VSiPZB53TmJvgurefWVUGB"
      })
    )

    {:ok, thread} = insert_thread!(workspace, "claude")

    {:ok, reply, joined} =
      subscribe_and_join(
        socket,
        SymphonyElixirWeb.SessionLogChannel,
        "session_log:agent:#{child_id}",
        %{
          "project_slug" => "advising",
          "agent_kind" => "claude",
          "session_id" => thread.id
        }
      )

    assert reply.agent_kind == "claude"
    assert reply.meta["id"] == child_id
    assert reply.meta["label"] == "Extract signatures"
    assert reply.meta["role"] == "Explore"
    assert reply.meta["tool_use_id"] == "toolu_01VSiPZB53TmJvgurefWVUGB"
    assert is_list(reply.entries)
    assert Enum.any?(reply.entries, fn entry -> entry["body"] == "hello-subagent" end)
    assert joined.assigns.subagent == true
    refute Map.has_key?(joined.assigns, :workspace)
    refute Map.has_key?(joined.assigns, :symphony_offset)
  end

  test "join rejects invalid subagent id", %{socket: socket} do
    result =
      subscribe_and_join(
        socket,
        SymphonyElixirWeb.SessionLogChannel,
        "session_log:agent:../etc",
        %{
          "project_slug" => "advising",
          "agent_kind" => "claude",
          "session_id" => 1
        }
      )

    assert {:error, %{reason: "session_log_unavailable"}} = result
  end

  test "join rejects unknown agent_kind", %{socket: socket} do
    workspace = tmp_workspace!("unknown-kind")
    {:ok, thread} = insert_thread!(workspace, "claude")

    result =
      subscribe_and_join(
        socket,
        SymphonyElixirWeb.SessionLogChannel,
        "session_log:agent:a0b70422f9f999605",
        %{
          "project_slug" => "advising",
          "agent_kind" => "not-an-agent",
          "session_id" => thread.id
        }
      )

    assert {:error, %{reason: "session_log_unavailable"}} = result
  end

  test "join rejects missing session_id", %{socket: socket} do
    result =
      subscribe_and_join(
        socket,
        SymphonyElixirWeb.SessionLogChannel,
        "session_log:agent:a0b70422f9f999605",
        %{
          "project_slug" => "advising",
          "agent_kind" => "claude"
        }
      )

    assert {:error, %{reason: "session_log_unavailable"}} = result
  end

  test "join rejects Codex rollout without parent_thread_id", %{socket: socket} do
    workspace = tmp_workspace!("codex-scope")
    {:ok, thread} = insert_thread!(workspace, "codex")
    :ok = SessionStore.append(workspace, thread.id, %{"type" => "assistant", "text" => "parent"})

    sessions_dir = Path.join(System.tmp_dir!(), "codex-sessions-#{System.unique_integer([:positive])}")
    File.mkdir_p!(sessions_dir)
    previous = Application.get_env(:symphony_elixir, :codex_sessions_dir)
    Application.put_env(:symphony_elixir, :codex_sessions_dir, sessions_dir)

    on_exit(fn ->
      case previous do
        nil -> Application.delete_env(:symphony_elixir, :codex_sessions_dir)
        value -> Application.put_env(:symphony_elixir, :codex_sessions_dir, value)
      end

      File.rm_rf(sessions_dir)
    end)

    uuid = "019f15d9-43f9-7443-8b33-c25bd6b47307"
    path = Path.join(sessions_dir, "rollout-2026-07-17T10-00-00-#{uuid}.jsonl")

    File.write!(
      path,
      Jason.encode!(%{
        "type" => "session_meta",
        "payload" => %{
          "id" => uuid,
          "agent_nickname" => "Orphan",
          "agent_role" => "explorer"
        }
      }) <> "\n"
    )

    result =
      subscribe_and_join(
        socket,
        SymphonyElixirWeb.SessionLogChannel,
        "session_log:agent:#{uuid}",
        %{
          "project_slug" => "advising",
          "agent_kind" => "codex",
          "session_id" => thread.id
        }
      )

    assert {:error, %{reason: "session_log_unavailable"}} = result
  end

  test "steer_turn on a subagent socket is read_only", %{socket: socket} do
    workspace = tmp_workspace!("steer-readonly")
    parent_path = SessionTranscript.path(:claude, workspace)
    File.mkdir_p!(Path.dirname(parent_path))
    File.write!(parent_path, "{}\n")

    child_id = "ad8a040be6a6e12f1"
    subagents = Path.join(Path.rootname(parent_path), "subagents")
    File.mkdir_p!(subagents)
    File.write!(Path.join(subagents, "agent-#{child_id}.jsonl"), "{}\n")

    File.write!(
      Path.join(subagents, "agent-#{child_id}.meta.json"),
      Jason.encode!(%{
        "agentType" => "Bash",
        "description" => "Run checks",
        "toolUseId" => "toolu_readonly"
      })
    )

    {:ok, thread} = insert_thread!(workspace, "claude")

    {:ok, _reply, joined} =
      subscribe_and_join(
        socket,
        SymphonyElixirWeb.SessionLogChannel,
        "session_log:agent:#{child_id}",
        %{
          "project_slug" => "advising",
          "agent_kind" => "claude",
          "session_id" => thread.id
        }
      )

    ref = push(joined, "steer_turn", %{"message" => "please change course"})
    assert_reply(ref, :error, %{reason: "read_only"})
  end

  defp insert_thread!(workspace, agent_kind) do
    %Thread{}
    |> Thread.changeset(%{
      scope: "issue_execution",
      project_slug: "advising",
      issue_identifier: "CDE-1180",
      workspace_path: workspace,
      agent_kind: agent_kind,
      status: "active"
    })
    |> Repo.insert()
  end

  defp tmp_workspace!(label) do
    workspace = Path.join(System.tmp_dir!(), "chan-agent-#{label}-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)
    workspace
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
