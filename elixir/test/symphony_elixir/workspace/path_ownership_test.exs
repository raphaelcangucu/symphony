defmodule SymphonyElixir.Workspace.PathOwnershipTestInventory do
  @moduledoc false

  @spec scan(String.t()) :: {:ok, map()} | {:error, term()}
  def scan(_project_slug) do
    Application.fetch_env!(:symphony_elixir, :path_ownership_test_scan_result)
  end
end

defmodule SymphonyElixir.Workspace.PathOwnershipTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow
  alias SymphonyElixir.Workspace.PathOwnership

  @scan_result_env :path_ownership_test_scan_result
  @inventory SymphonyElixir.Workspace.PathOwnershipTestInventory

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    tmp = Path.join(System.tmp_dir!(), "path-ownership-#{System.unique_integer([:positive])}")
    root = Path.join(tmp, "workspaces")
    project_root = Path.join(root, "demo")
    workspace_path = Path.join(project_root, "DEM-1")
    File.mkdir_p!(workspace_path)

    workflow_file = Path.join(tmp, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: root)
    Workflow.set_workflow_file_path(workflow_file)
    {:ok, _project} = Context.ensure_project(%{name: "Demo", slug: "demo"})

    entry = %{path: workspace_path, kind: :issue, issue_identifier: "DEM-1", child_worktrees: []}
    set_scan_result({:ok, %{workspaces: [entry]}})

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, @scan_result_env)
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf(tmp)
    end)

    {:ok, entry: entry, project_root: project_root, tmp: tmp, workspace_path: workspace_path}
  end

  test "normalizes an exact current inventory entry", %{entry: entry, workspace_path: workspace_path} do
    requested_path = "  #{Path.join(workspace_path, "nested/..")}  "

    assert {:ok, %{path: ^workspace_path, entry: ^entry, entry_type: :workspace}} =
             PathOwnership.validate("demo", requested_path, inventory_module: @inventory)
  end

  test "accepts an exact child worktree inventory entry", %{entry: entry, workspace_path: workspace_path} do
    child_path = Path.join(workspace_path, ".worktrees/child")
    File.mkdir_p!(child_path)
    child = %{path: child_path, repo_name: "app", slug: "child"}
    set_scan_result({:ok, %{workspaces: [%{entry | child_worktrees: [child]}]}})

    assert {:ok, %{path: ^child_path, entry: ^child, entry_type: :child_worktree}} =
             PathOwnership.validate("demo", child_path, inventory_module: @inventory)
  end

  test "rejects invalid, missing, sibling-prefix, and absent inventory paths", %{
    project_root: project_root,
    workspace_path: workspace_path
  } do
    missing_path = Path.join(project_root, "missing")
    sibling_path = project_root <> "-sibling/workspace"
    File.mkdir_p!(sibling_path)
    absent_path = Path.join(project_root, "absent")
    File.mkdir_p!(absent_path)

    assert {:error, {:validation, :invalid_workspace_path}} =
             PathOwnership.validate("demo", "relative", inventory_module: @inventory)

    assert {:error, {:validation, :invalid_workspace_path}} =
             PathOwnership.validate("demo", workspace_path <> <<0>>, inventory_module: @inventory)

    for path <- [missing_path, sibling_path, absent_path, project_root] do
      assert {:error, {:validation, :workspace_path_not_owned}} =
               PathOwnership.validate("demo", path, inventory_module: @inventory)
    end
  end

  test "rejects symlink escapes and fails closed", %{project_root: project_root, tmp: tmp} do
    outside_path = Path.join(tmp, "outside")
    File.mkdir_p!(outside_path)
    symlink_path = Path.join(project_root, "linked")
    File.ln_s!(outside_path, symlink_path)
    entry = %{path: symlink_path, kind: :standalone, issue_identifier: nil, child_worktrees: []}
    set_scan_result({:ok, %{workspaces: [entry]}})

    assert {:error, {:validation, :workspace_path_not_owned}} =
             PathOwnership.validate("demo", symlink_path, inventory_module: @inventory)
  end

  test "tags inventory operational failures", %{workspace_path: workspace_path} do
    set_scan_result({:error, :inventory_failed})

    assert {:error, {:inventory, :inventory_failed}} =
             PathOwnership.validate("demo", workspace_path, inventory_module: @inventory)
  end

  test "validates project existence before inventory", %{workspace_path: workspace_path} do
    assert {:error, :project_not_found} =
             PathOwnership.validate("missing", workspace_path, inventory_module: @inventory)
  end

  defp set_scan_result(result), do: Application.put_env(:symphony_elixir, @scan_result_env, result)

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
