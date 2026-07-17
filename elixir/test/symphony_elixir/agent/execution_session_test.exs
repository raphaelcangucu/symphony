defmodule SymphonyElixir.Agent.ExecutionSessionTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias SymphonyElixir.Agent.ExecutionSession
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    SQL.query!(Repo, "DELETE FROM assistant_threads", [])
    :ok
  end

  test "ensure/3 creates one issue_execution session and reuses it while active" do
    {:ok, s1} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    {:ok, s2} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    assert s1.id == s2.id
    assert s1.scope == "issue_execution"
    assert s1.metadata["origin"] == "orchestrator"
  end

  test "ensure/3 reopens the latest finished session and updates agent_kind" do
    {:ok, original} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    {:ok, _finished} = ExecutionSession.finish(original.id, "aborted")

    {:ok, resumed} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "cursor"
      )

    assert resumed.id == original.id
    assert resumed.status == "active"
    assert resumed.agent_kind == "cursor"
  end

  test "ensure/3 with force_new creates a distinct session after finish" do
    {:ok, original} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    {:ok, _finished} = ExecutionSession.finish(original.id, "aborted")

    {:ok, forced} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "cursor",
        force_new: true
      )

    assert forced.id != original.id
    assert forced.status == "active"
    assert forced.agent_kind == "cursor"
  end

  test "finish/2 maps a run outcome onto the stored status enum and persists it" do
    {:ok, s} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    {:ok, closed} = ExecutionSession.finish(s.id, "aborted")
    assert closed.status == "error"
    assert {:ok, reloaded} = History.get_thread(s.id)
    assert reloaded.status == "error"
  end

  test "recent_non_live/0 returns finished execution sessions and excludes active ones" do
    {:ok, active} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    {:ok, other} =
      ExecutionSession.ensure("advising", "CDE-2000",
        workspace_path: "/tmp/advising/CDE-2000",
        agent_kind: "codex"
      )

    {:ok, _finished} = ExecutionSession.finish(other.id, "completed")

    recent = ExecutionSession.recent_non_live()
    ids = Enum.map(recent, & &1.id)
    assert other.id in ids
    refute active.id in ids
  end

  test "archive_latest/2 prevents ensure/3 from reusing the prior session" do
    {:ok, original} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    assert {:ok, archived} = ExecutionSession.archive_latest("advising", "CDE-1180")
    assert archived.id == original.id
    assert archived.status == "archived"

    {:ok, next} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "cursor"
      )

    assert next.id != original.id
    assert next.status == "active"
  end

  test "latest_agent_kind/2 returns the reusable execution thread agent_kind" do
    assert ExecutionSession.latest_agent_kind("advising", "CDE-1180") == nil

    {:ok, _session} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "cursor"
      )

    assert ExecutionSession.latest_agent_kind("advising", "CDE-1180") == "cursor"
  end

  test "latest_agent_kind/2 ignores archived sessions and prefers the latest reusable one" do
    {:ok, older} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "codex"
      )

    assert {:ok, _} = ExecutionSession.archive_latest("advising", "CDE-1180")

    {:ok, newer} =
      ExecutionSession.ensure("advising", "CDE-1180",
        workspace_path: "/tmp/advising/CDE-1180",
        agent_kind: "claude"
      )

    assert newer.id != older.id
    assert ExecutionSession.latest_agent_kind("advising", "CDE-1180") == "claude"

    {:ok, _} = ExecutionSession.finish(newer.id, "completed")
    assert ExecutionSession.latest_agent_kind("advising", "CDE-1180") == "claude"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
