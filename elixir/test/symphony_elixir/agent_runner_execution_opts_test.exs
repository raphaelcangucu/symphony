defmodule SymphonyElixir.AgentRunnerExecutionOptsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.IssueAgentSettings
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    Repo.delete_all(IssueAgentSettings)
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
    issue = %Issue{project_slug: "demo", identifier: "MISSING"}
    assert AgentRunner.agent_settings_opts(issue) == []
  end

  test "agent_settings_opts omits keys that were never set" do
    :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: "gpt-5.5"})
    issue = %Issue{project_slug: "demo", identifier: "DEMO-1"}

    opts = AgentRunner.agent_settings_opts(issue)

    assert Keyword.get(opts, :model) == "gpt-5.5"
    refute Keyword.has_key?(opts, :effort)
    refute Keyword.has_key?(opts, :execution_mode)
  end

  test "put_execution_mode sets the normalized mode when the operator selected one" do
    assert Keyword.get(AgentRunner.put_execution_mode([], execution_mode: "plan"), :execution_mode) == "plan"
    assert Keyword.get(AgentRunner.put_execution_mode([], execution_mode: "yolo"), :execution_mode) == "yolo"
    # An invalid but present mode still coerces to the default.
    assert Keyword.get(AgentRunner.put_execution_mode([], execution_mode: "turbo"), :execution_mode) == "build"
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
