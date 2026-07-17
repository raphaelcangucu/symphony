defmodule SymphonyElixir.AgentRunnerAgentKindTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Agent.ExecutionSession
  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    on_exit(fn -> Repo.delete_all(Setting) end)

    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)

    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    {:ok, project} = Context.ensure_project(%{name: "Pref", slug: "pref"})

    {:ok, _} =
      Context.upsert_project_setup("pref", %{
        "workflow_markdown" => """
        ---
        agent:
          kind: claude
        ---
        Prompt body.
        """
      })

    {:ok, project: project}
  end

  test "issue label beats the project's explicit agent.kind" do
    issue = %Issue{id: "1", identifier: "PREF-1", project_slug: "pref", agent_kind: "codex"}
    assert AgentRunner.issue_agent_kind(issue) == "codex"
  end

  test "project explicit agent.kind beats the user default" do
    {:ok, _} = Settings.put("agents", "default_agent_kind", "codex")
    issue = %Issue{id: "1", identifier: "PREF-1", project_slug: "pref", agent_kind: nil}
    assert AgentRunner.issue_agent_kind(issue) == "claude"
  end

  test "user default applies when the project inherits" do
    {:ok, _} =
      Context.upsert_project_setup("pref", %{
        "workflow_markdown" => "---\n---\nPrompt body."
      })

    {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")

    issue = %Issue{id: "1", identifier: "PREF-1", project_slug: "pref", agent_kind: nil}
    assert AgentRunner.issue_agent_kind(issue) == "claude"
  end

  test "unknown project falls back to user default then codex" do
    issue = %Issue{id: "1", identifier: "X-1", project_slug: "missing", agent_kind: nil}
    assert AgentRunner.issue_agent_kind(issue) == "codex"
  end

  test "settings.agent_kind beats label agent_kind" do
    :ok = Context.put_agent_settings("pref", "PREF-9", %{agent_kind: "cursor"})
    issue = %Issue{id: "9", identifier: "PREF-9", project_slug: "pref", agent_kind: "codex"}
    assert AgentRunner.issue_agent_kind(issue) == "cursor"
  end

  test "label agent is used when settings agent_kind is empty" do
    issue = %Issue{id: "10", identifier: "PREF-10", project_slug: "pref", agent_kind: "codex"}
    assert AgentRunner.issue_agent_kind(issue) == "codex"
  end

  test "execution thread agent_kind beats settings and labels" do
    :ok = Context.put_agent_settings("pref", "PREF-THREAD", %{agent_kind: "codex"})

    {:ok, _session} =
      ExecutionSession.ensure("pref", "PREF-THREAD",
        workspace_path: "/tmp/pref/PREF-THREAD",
        agent_kind: "cursor"
      )

    issue = %Issue{
      id: "11",
      identifier: "PREF-THREAD",
      project_slug: "pref",
      agent_kind: "claude"
    }

    assert AgentRunner.issue_agent_kind(issue) == "cursor"
  end

  test "falls through when execution thread has no agent_kind" do
    {:ok, session} =
      ExecutionSession.ensure("pref", "PREF-EMPTY",
        workspace_path: "/tmp/pref/PREF-EMPTY",
        agent_kind: "cursor"
      )

    {:ok, _} = SymphonyElixir.Assistant.History.update_thread(session, %{agent_kind: nil})

    issue = %Issue{
      id: "12",
      identifier: "PREF-EMPTY",
      project_slug: "pref",
      agent_kind: "codex"
    }

    assert AgentRunner.issue_agent_kind(issue) == "codex"
  end
end
