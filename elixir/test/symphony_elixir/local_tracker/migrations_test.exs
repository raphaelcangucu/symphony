defmodule SymphonyElixir.LocalTracker.MigrationsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo

  setup_all do
    migrate_repo()
    :ok
  end

  test "local tracker tables exist" do
    table_names =
      Repo.query!("select name from sqlite_master where type = 'table'")
      |> Map.fetch!(:rows)
      |> List.flatten()

    assert "local_tracker_projects" in table_names
    assert "local_tracker_workflow_statuses" in table_names
    assert "local_tracker_issues" in table_names
    assert "local_tracker_comments" in table_names
    assert "local_tracker_labels" in table_names
    assert "local_tracker_issue_labels" in table_names
    assert "local_tracker_issue_relations" in table_names
    assert "local_tracker_activity_events" in table_names
  end

  test "local tracker indexes enforce project-scoped uniqueness" do
    index_names =
      Repo.query!("select name from sqlite_master where type = 'index'")
      |> Map.fetch!(:rows)
      |> List.flatten()

    assert "local_tracker_projects_slug_index" in index_names
    assert "local_tracker_workflow_statuses_project_id_name_index" in index_names
    assert "local_tracker_issues_project_id_identifier_index" in index_names
    assert "local_tracker_issue_relations_source_issue_id_target_issue_id_type_index" in index_names
  end

  test "local_tracker_projects has tracker_kind and tracker_config columns" do
    migrate_repo()

    %{rows: rows} = Repo.query!("PRAGMA table_info(local_tracker_projects)")
    column_names = Enum.map(rows, fn row -> Enum.at(row, 1) end)

    assert "tracker_kind" in column_names
    assert "tracker_config" in column_names
  end

  test "workspace template tables exist" do
    migrate_repo()

    for table <- [
          "local_tracker_workspace_templates",
          "local_tracker_workspace_template_repositories",
          "local_tracker_clone_jobs"
        ] do
      assert %{rows: _} = Repo.query!("SELECT 1 FROM #{table} LIMIT 1")
    end
  end

  test "dev env tables exist" do
    migrate_repo()

    for t <- ["local_tracker_dev_env_steps", "local_tracker_dev_env_runs", "local_tracker_dev_env_step_runs"] do
      assert %{rows: _} = Repo.query!("SELECT 1 FROM #{t} LIMIT 1")
    end
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
