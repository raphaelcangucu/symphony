defmodule SymphonyElixir.Assistant.ToolExecutorDispatchTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias SymphonyElixir.Assistant.ToolExecutor
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    migrate_repo()
    clean_repo()
    Repo.delete_all(Setting)
    on_exit(fn -> Repo.delete_all(Setting) end)
    {:ok, _project} = Context.ensure_project(%{name: "Pref", slug: "pref"})
    {:ok, issue} = Context.create_issue("pref", %{"title" => "Dispatchable", "status" => "Todo"})
    {:ok, issue: issue}
  end

  test "dispatch_coding_agent honors the explicit agent argument", %{issue: issue} do
    {:ok, result} =
      ToolExecutor.execute("pref", "dispatch_coding_agent", %{
        "identifier" => issue.identifier,
        "instructions" => "do it",
        "agent" => "claude"
      })

    assert result.tool == "dispatch_coding_agent"
    assert result.message =~ "Claude"
    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert "symphony:claude" in label_names(updated)
  end

  test "without an agent argument the chain resolves (user default claude)", %{issue: issue} do
    {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")

    {:ok, result} =
      ToolExecutor.execute("pref", "dispatch_coding_agent", %{
        "identifier" => issue.identifier,
        "instructions" => "do it"
      })

    assert result.message =~ "Claude"
    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert "symphony:claude" in label_names(updated)
  end

  test "task label beats project and user at dispatch", %{issue: issue} do
    {:ok, _} = Context.update_issue("pref", issue.identifier, %{"agent" => "claude"})

    {:ok, result} =
      ToolExecutor.execute("pref", "dispatch_coding_agent", %{
        "identifier" => issue.identifier,
        "instructions" => "do it"
      })

    assert result.message =~ "Claude"
  end

  test "dispatch_codex stays as a working alias", %{issue: issue} do
    {:ok, result} =
      ToolExecutor.execute("pref", "dispatch_codex", %{
        "identifier" => issue.identifier,
        "instructions" => "do it"
      })

    assert result.message =~ "Codex"
  end

  test "claude dispatch persists the workflow objective", %{issue: issue} do
    {:ok, result} =
      ToolExecutor.execute("pref", "dispatch_coding_agent", %{
        "identifier" => issue.identifier,
        "instructions" => "do it",
        "agent" => "claude",
        "goal" => "  long workflow  "
      })

    assert result.data.agent_goal == "long workflow"

    {:ok, reloaded} = Context.get_issue("pref", issue.identifier)
    assert reloaded.agent_goal == "long workflow"
  end

  defp label_names(issue) do
    issue |> Map.get(:labels) |> Enum.map(& &1.name)
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
          "local_tracker_projects",
          "local_tracker_workspace_template_repositories",
          "local_tracker_workspace_templates"
        ] do
      SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
