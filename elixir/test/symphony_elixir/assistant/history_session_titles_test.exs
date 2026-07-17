defmodule SymphonyElixir.Assistant.HistorySessionTitlesTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Agent.ExecutionSession
  alias SymphonyElixir.Assistant.{History, Thread}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!()
    Ecto.Adapters.SQL.query!(Repo, "DELETE FROM assistant_messages", [])
    Ecto.Adapters.SQL.query!(Repo, "DELETE FROM assistant_threads", [])
    :ok
  end

  test "create_issue_session_thread defaults title to Chat · identifier" do
    {:ok, _project} = Context.ensure_project(%{name: "Session Titles", slug: "session-titles"})

    {:ok, issue} =
      Context.create_issue("session-titles", %{"title" => "Fix login race", "status" => "Todo"})

    assert {:ok, %Thread{} = thread} =
             History.create_issue_session_thread("session-titles", issue.identifier, %{})

    assert String.starts_with?(thread.title, "Chat · ")
    assert String.contains?(thread.title, issue.identifier)
  end

  test "ExecutionSession.ensure defaults title to Run · identifier" do
    {:ok, _project} = Context.ensure_project(%{name: "Session Titles", slug: "session-titles"})

    {:ok, issue} =
      Context.create_issue("session-titles", %{"title" => "Fix login race", "status" => "Todo"})

    workspace = Path.join(System.tmp_dir!(), "session-titles/#{issue.identifier}")

    assert {:ok, %Thread{} = thread} =
             ExecutionSession.ensure("session-titles", issue.identifier,
               workspace_path: workspace,
               agent_kind: "codex"
             )

    assert String.starts_with?(thread.title, "Run · ")
    assert String.contains?(thread.title, issue.identifier)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
