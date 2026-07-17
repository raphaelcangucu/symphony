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

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
