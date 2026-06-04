defmodule SymphonyElixir.Tracker.Sync.LocalFirstTrackerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, Project, ProjectSetup}
  alias SymphonyElixir.{Repo, Workflow}
  alias SymphonyElixir.Tracker.Sync.{LocalFirstTracker, LocalStore, Outbox}

  setup do
    migrate_repo()
    clean_repo()

    {:ok, project} =
      Context.ensure_project(%{
        name: "repo",
        slug: "repo",
        tracker_kind: "github",
        tracker_config: %{"repo" => "owner/repo", "project_id" => "PVT_1"}
      })

    upsert(project, "1", "alice")
    upsert(project, "2", "bob")

    Application.put_env(:symphony_elixir, :tracker_sync_project_slug, "repo")

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :tracker_sync_assignee_fun)
      Application.delete_env(:symphony_elixir, :tracker_sync_project_slug)
    end)

    %{project: project}
  end

  defp upsert(project, identifier, assignee, state \\ "Todo") do
    {:ok, _} =
      LocalStore.upsert_remote_issue(project, %{
        remote_id: "I_#{identifier}",
        remote_number: String.to_integer(identifier),
        identifier: identifier,
        title: "t#{identifier}",
        description: nil,
        state: state,
        priority: nil,
        assignee_id: assignee,
        branch_name: nil,
        remote_url: "u",
        creator: nil,
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      })
  end

  defp stub_assignee(result), do: Application.put_env(:symphony_elixir, :tracker_sync_assignee_fun, fn _ -> result end)

  defp setup_global_workflow(active_states) do
    workflow_root =
      Path.join(System.tmp_dir!(), "symphony-lft-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workflow_root)
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")

    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file,
      tracker_kind: "local",
      workspace_root: workflow_root,
      tracker_active_states: active_states
    )

    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(workflow_root)
    end)
  end

  defp local_project_with_active_states(slug, active_states) do
    {:ok, project} = Context.ensure_project(%{name: slug, slug: slug, tracker_kind: "local"})

    {:ok, _setup} =
      %ProjectSetup{}
      |> ProjectSetup.changeset(%{
        project_id: project.id,
        workflow_markdown:
          SymphonyElixir.Workflow.to_markdown(
            %{"tracker" => %{"active_states" => active_states}},
            ""
          ),
        validation_commands: %{"commands" => []},
        scan_summary: %{}
      })
      |> Repo.insert()

    Repo.get!(Project, project.id) |> Repo.preload(:setup)
  end

  defp local_project_with_config(slug, workflow_config) do
    {:ok, project} = Context.ensure_project(%{name: slug, slug: slug, tracker_kind: "local"})

    {:ok, _setup} =
      %ProjectSetup{}
      |> ProjectSetup.changeset(%{
        project_id: project.id,
        workflow_markdown: SymphonyElixir.Workflow.to_markdown(workflow_config, ""),
        validation_commands: %{"commands" => []},
        scan_summary: %{}
      })
      |> Repo.insert()

    Repo.get!(Project, project.id) |> Repo.preload(:setup)
  end

  defp seed_issue(project, identifier, state) do
    {:ok, _} =
      LocalStore.upsert_remote_issue(project, %{
        remote_id: "I_#{project.slug}_#{identifier}",
        remote_number: System.unique_integer([:positive]),
        identifier: identifier,
        title: identifier,
        description: nil,
        state: state,
        priority: nil,
        assignee_id: nil,
        branch_name: nil,
        remote_url: "u",
        creator: nil,
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      })
  end

  test "candidate fetch uses per-project active states" do
    Application.delete_env(:symphony_elixir, :tracker_sync_project_slug)
    stub_assignee({:ok, :any})
    setup_global_workflow(["Todo", "In Progress"])

    project_a = local_project_with_active_states("a", ["Doing"])
    project_b = local_project_with_active_states("b", ["Building"])

    seed_issue(project_a, "a-doing", "Doing")
    seed_issue(project_a, "a-backlog", "Backlog")
    seed_issue(project_b, "b-building", "Building")
    seed_issue(project_b, "b-backlog", "Backlog")

    {:ok, issues} = LocalFirstTracker.fetch_candidate_issues()
    pairs = issues |> Enum.map(&{&1.project_slug, &1.state}) |> Enum.sort()

    assert {"a", "Doing"} in pairs
    assert {"b", "Building"} in pairs
    refute Enum.any?(pairs, fn {_slug, state} -> state == "Backlog" end)
  end

  test "candidate fetch isolates a project whose resolution raises and keeps valid ones" do
    Application.delete_env(:symphony_elixir, :tracker_sync_project_slug)
    setup_global_workflow(["Todo", "In Progress"])

    valid_project = local_project_with_active_states("valid", ["Doing"])
    broken_project = local_project_with_active_states("broken", ["Doing"])

    seed_issue(valid_project, "valid-doing", "Doing")
    seed_issue(broken_project, "broken-doing", "Doing")

    Application.put_env(:symphony_elixir, :tracker_sync_assignee_fun, fn
      %{slug: "broken"} -> raise "boom: cannot resolve viewer login"
      _project -> {:ok, :any}
    end)

    assert {:ok, issues} = LocalFirstTracker.fetch_candidate_issues()
    slugs = issues |> Enum.map(& &1.project_slug) |> Enum.uniq()

    assert "valid" in slugs
    refute "broken" in slugs
    assert Enum.any?(issues, &(&1.identifier == "valid-doing"))
    refute Enum.any?(issues, &(&1.identifier == "broken-doing"))
  end

  test "candidate fetch skips a project with a malformed workflow_config and keeps valid ones" do
    Application.delete_env(:symphony_elixir, :tracker_sync_project_slug)
    stub_assignee({:ok, :any})
    setup_global_workflow(["Todo", "In Progress"])

    valid_project = local_project_with_active_states("valid", ["Doing"])
    malformed_project = local_project_with_config("malformed", %{"tracker" => %{"active_states" => 123}})

    seed_issue(valid_project, "valid-doing", "Doing")
    seed_issue(malformed_project, "malformed-doing", "Doing")

    assert {:ok, issues} = LocalFirstTracker.fetch_candidate_issues()
    slugs = issues |> Enum.map(& &1.project_slug) |> Enum.uniq()

    assert "valid" in slugs
    refute "malformed" in slugs
  end

  test "fetch_issues_by_states returns only the worker's issues with assigned_to_worker true" do
    stub_assignee({:ok, "alice"})

    assert {:ok, [issue]} = LocalFirstTracker.fetch_issues_by_states(["Todo"])
    assert issue.identifier == "1"
    assert issue.assigned_to_worker == true
  end

  test "no assignee configured returns all active issues (remote parity)" do
    stub_assignee({:ok, :any})
    assert {:ok, issues} = LocalFirstTracker.fetch_issues_by_states(["Todo"])
    assert length(issues) == 2
  end

  test "unresolved assignee returns nothing (safe: never grab wrong issues)" do
    stub_assignee({:error, :missing_viewer})
    assert {:ok, []} = LocalFirstTracker.fetch_issues_by_states(["Todo"])
  end

  test "fetch_issues_by_states reads all non-archived projects when slug override is unset" do
    Application.delete_env(:symphony_elixir, :tracker_sync_project_slug)
    stub_assignee({:ok, :any})

    {:ok, board} =
      Context.ensure_project(%{
        name: "Macro Markets",
        slug: "macro-markets",
        tracker_kind: "github",
        tracker_config: %{"repo" => "owner/repo", "project_id" => "PVT_2"}
      })

    upsert(board, "510", nil, "Rework")

    assert {:ok, issues} = LocalFirstTracker.fetch_issues_by_states(["Todo", "Rework"])
    assert Enum.sort(Enum.map(issues, & &1.identifier)) == ["1", "2", "510"]
  end

  test "archived projects are excluded from orchestrator reads" do
    Application.delete_env(:symphony_elixir, :tracker_sync_project_slug)
    stub_assignee({:ok, :any})

    {:ok, board} =
      Context.ensure_project(%{
        name: "Macro Markets",
        slug: "macro-markets",
        tracker_kind: "github",
        tracker_config: %{"repo" => "owner/repo", "project_id" => "PVT_2"}
      })

    upsert(board, "510", nil, "Rework")
    assert {:ok, _} = Context.archive_project("macro-markets")

    assert {:ok, issues} = LocalFirstTracker.fetch_issues_by_states(["Todo", "Rework"])
    assert Enum.sort(Enum.map(issues, & &1.identifier)) == ["1", "2"]
  end

  test "fetch_issue_states_by_ids resolves local database ids across projects" do
    Application.delete_env(:symphony_elixir, :tracker_sync_project_slug)
    stub_assignee({:ok, :any})

    {:ok, board} =
      Context.ensure_project(%{
        name: "Macro Markets",
        slug: "macro-markets",
        tracker_kind: "github",
        tracker_config: %{"repo" => "owner/repo", "project_id" => "PVT_2"}
      })

    upsert(board, "510", nil, "Rework")
    {:ok, [issue | _]} = LocalFirstTracker.fetch_issues_by_states(["Rework"])
    assert issue.identifier == "510"

    assert {:ok, [refreshed]} = LocalFirstTracker.fetch_issue_states_by_ids([issue.id])
    assert refreshed.identifier == "510"
  end

  test "create_comment writes locally and enqueues", %{project: project} do
    stub_assignee({:ok, "alice"})
    assert :ok = LocalFirstTracker.create_comment("1", "hello")
    assert Outbox.pending_count(project.id) == 1
  end

  test "update_issue_state moves locally and enqueues", %{project: project} do
    stub_assignee({:ok, "alice"})
    assert :ok = LocalFirstTracker.update_issue_state("1", "Done")
    assert Outbox.pending_count(project.id) == 1
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
