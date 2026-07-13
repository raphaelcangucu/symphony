defmodule SymphonyElixir.AgentRunnerExecutionOptsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.IssueAgentSettings
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    migrate_repo()
    Repo.delete_all(IssueAgentSettings)
    Repo.delete_all(Setting)
    on_exit(fn -> Repo.delete_all(Setting) end)

    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    {:ok, _project} = Context.ensure_project(%{name: "Demo", slug: "demo"})

    {:ok, _} =
      Context.upsert_project_setup("demo", %{
        "workflow_markdown" => """
        ---
        agent:
          kind: codex
          model: project-model
          effort: medium
        ---
        Prompt body.
        """
      })

    :ok
  end

  test "agent_settings_opts loads persisted model/effort/mode for the issue" do
    :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: "gpt-5.5", effort: "high", mode: "plan"})
    issue = %Issue{project_slug: "demo", identifier: "DEMO-1"}

    opts = AgentRunner.agent_settings_opts(issue)

    assert Keyword.get(opts, :model) == "gpt-5.5"
    assert Keyword.get(opts, :effort) == "high"
    assert Keyword.get(opts, :execution_mode) == "plan"
  end

  test "agent_settings_opts returns [] when nothing is persisted" do
    issue = %Issue{project_slug: "missing", identifier: "MISSING"}
    assert AgentRunner.agent_settings_opts(issue) == []
  end

  test "agent_settings_opts omits keys that were never set" do
    {:ok, _} =
      Context.upsert_project_setup("demo", %{
        "workflow_markdown" => """
        ---
        agent:
          kind: codex
        ---
        Prompt body.
        """
      })

    :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: "gpt-5.5"})
    issue = %Issue{project_slug: "demo", identifier: "DEMO-1"}

    opts = AgentRunner.agent_settings_opts(issue)

    assert Keyword.get(opts, :model) == "gpt-5.5"
    refute Keyword.has_key?(opts, :effort)
    refute Keyword.has_key?(opts, :execution_mode)
  end

  test "issue settings model beats project and user" do
    {:ok, _} = Settings.put("agent_models", "codex", "gpt-5-codex")
    {:ok, _} = Settings.put("agent_efforts", "codex", "low")

    :ok =
      Context.put_agent_settings("demo", "DEMO-WIN", %{
        model: "gpt-5.5",
        effort: "xhigh"
      })

    issue = %Issue{project_slug: "demo", identifier: "DEMO-WIN", agent_kind: "codex"}
    opts = AgentRunner.agent_settings_opts(issue)

    assert Keyword.get(opts, :model) == "gpt-5.5"
    assert Keyword.get(opts, :effort) == "xhigh"
  end

  test "agent_settings_opts falls back to project then user model/effort" do
    {:ok, _} = Settings.put("agent_models", "codex", "gpt-5")
    {:ok, _} = Settings.put("agent_efforts", "codex", "low")

    issue = %Issue{project_slug: "demo", identifier: "DEMO-FALLBACK", agent_kind: "codex"}
    opts = AgentRunner.agent_settings_opts(issue)

    assert Keyword.get(opts, :model) == "project-model"
    assert Keyword.get(opts, :effort) == "medium"
    refute Keyword.has_key?(opts, :execution_mode)

    {:ok, _} =
      Context.upsert_project_setup("demo", %{
        "workflow_markdown" => """
        ---
        agent:
          kind: codex
        ---
        Prompt body.
        """
      })

    opts_user = AgentRunner.agent_settings_opts(issue)

    assert Keyword.get(opts_user, :model) == "gpt-5"
    assert Keyword.get(opts_user, :effort) == "low"
  end

  test "agent_settings_opts mode still comes only from issue settings" do
    :ok = Context.put_agent_settings("demo", "DEMO-MODE", %{mode: "plan"})
    issue = %Issue{project_slug: "demo", identifier: "DEMO-MODE", agent_kind: "codex"}

    opts = AgentRunner.agent_settings_opts(issue)

    assert Keyword.get(opts, :execution_mode) == "plan"
    assert Keyword.get(opts, :model) == "project-model"
    assert Keyword.get(opts, :effort) == "medium"
  end

  test "put_execution_mode sets the normalized mode when the operator selected one" do
    assert Keyword.get(AgentRunner.put_execution_mode([], execution_mode: "plan"), :execution_mode) == "plan"
    assert Keyword.get(AgentRunner.put_execution_mode([], execution_mode: "yolo"), :execution_mode) == "yolo"
    # An invalid but present mode still coerces to the default.
    assert Keyword.get(AgentRunner.put_execution_mode([], execution_mode: "turbo"), :execution_mode) == "yolo"
  end

  test "put_execution_mode leaves session opts untouched when no mode was selected" do
    refute Keyword.has_key?(AgentRunner.put_execution_mode([], []), :execution_mode)
    refute Keyword.has_key?(AgentRunner.put_execution_mode([], execution_mode: nil), :execution_mode)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
