defmodule SymphonyElixir.Assistant.ForkSessionTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Agent.ConversationRef
  alias SymphonyElixir.Assistant.{ForkSession, History, Thread}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  setup do
    migrate_repo()
    clean_repo()

    tmp_dir = Path.join(System.tmp_dir!(), "symphony-fork-test-#{System.unique_integer([:positive])}")
    File.rm_rf!(tmp_dir)
    File.mkdir_p!(tmp_dir)

    workflow_file = Path.join(tmp_dir, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: tmp_dir)
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(tmp_dir)
    end)

    {:ok, tmp_dir: tmp_dir}
  end

  test "forking an issue_session copies transcript into a fresh isolated thread" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    {:ok, source} =
      History.create_issue_session_thread("macro-markets", "MAC-510", %{
        title: "Nova sessao",
        agent_kind: "claude",
        execution_mode: "build",
        requested_model: "claude-sonnet-5",
        requested_effort: "medium"
      })

    {:ok, ref} = ConversationRef.new("claude", "claude-native-abc")
    {:ok, source} = History.put_conversation_ref(source, ref)

    {:ok, source} =
      History.put_model_provenance(source, %{
        resolved_model: "claude-sonnet-5",
        resolved_effort: "medium"
      })

    {:ok, _} = History.append_message(source, %{role: "user", content: "context please"})
    {:ok, _} = History.append_message(source, %{role: "assistant", content: "got it"})

    assert {:ok, %Thread{} = fork} = ForkSession.fork(source)

    assert fork.id != source.id
    assert fork.scope == "issue_session"
    assert fork.issue_identifier == "MAC-510"
    assert fork.agent_kind == "claude"
    assert fork.title == "Nova sessao (fork)"
    assert fork.workspace_path != source.workspace_path
    assert fork.metadata["forked_from_thread_id"] == source.id
    assert fork.metadata["workspace_kind"] == "isolated"
    assert fork.requested_model == "claude-sonnet-5"
    assert fork.requested_effort == "medium"
    assert fork.resolved_model == nil
    assert fork.resolved_effort == nil

    # Clean fork: no native agent brain carried over.
    assert fork.provider_bindings == %{}

    copied = History.list_messages_for_thread(fork.id)
    assert Enum.map(copied, & &1.role) == ["user", "assistant"]
    assert Enum.map(copied, & &1.content) == ["context please", "got it"]
  end

  test "forking a project_session creates a standalone workspace thread" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    {:ok, source} =
      History.create_project_session_thread("macro-markets", %{
        title: "Explore",
        requested_model: "gpt-5.6-terra",
        requested_effort: "low"
      })

    {:ok, _} = History.append_message(source, %{role: "user", content: "hello"})

    assert {:ok, %Thread{} = fork} = ForkSession.fork(source)

    assert fork.id != source.id
    assert fork.scope == "project_session"
    assert fork.title == "Explore (fork)"
    assert fork.workspace_path != source.workspace_path
    assert fork.metadata["forked_from_thread_id"] == source.id
    assert fork.requested_model == "gpt-5.6-terra"
    assert fork.requested_effort == "low"
    assert fork.resolved_model == nil
    assert fork.resolved_effort == nil
    assert fork.provider_bindings == %{}
    assert Enum.map(History.list_messages_for_thread(fork.id), & &1.content) == ["hello"]
  end

  test "forking an unsupported scope is rejected" do
    {:ok, source} = History.create_freeform_thread(%{title: "Freeform", workspace_path: System.tmp_dir!()})
    assert {:error, :unsupported_scope} = ForkSession.fork(source)
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
          "local_tracker_projects"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
