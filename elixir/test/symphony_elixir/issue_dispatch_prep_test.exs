defmodule SymphonyElixir.IssueDispatchPrepTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.IssueDispatchPrep
  alias SymphonyElixir.LocalTracker.{Context, Viewer}

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!()

    unless Process.whereis(Viewer.Server) do
      {:ok, _pid} = start_supervised(Viewer.Server)
    end

    Viewer.invalidate_cache()
    Viewer.put_cached(%{login: "raphaelcangucu", name: nil, avatar_url: nil})

    on_exit(fn -> Viewer.invalidate_cache() end)

    {:ok, project} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, parent} = Context.create_issue("macro", %{"title" => "Parent", "status" => "Todo"})
    {:ok, child} = Context.create_issue("macro", %{"title" => "Child", "status" => "Todo"})

    {:ok, project: project, parent: parent, child: child}
  end

  test "sets assignee and symphony label when both are missing", %{project: project, parent: parent} do
    assert :ok = IssueDispatchPrep.ensure_dispatch_gates(project, parent.identifier, "codex")

    assert {:ok, updated} = Context.get_issue("macro", parent.identifier)
    assert updated.assignee_id == "raphaelcangucu"
    assert "symphony:codex" in Enum.map(updated.labels, & &1.name)
  end

  test "does not overwrite an existing assignee", %{project: project, parent: parent} do
    {:ok, _} =
      Context.update_issue("macro", parent.identifier, %{"assignee_ids" => ["other-user"]})

    assert :ok = IssueDispatchPrep.ensure_dispatch_gates(project, parent.identifier, "codex")

    assert {:ok, updated} = Context.get_issue("macro", parent.identifier)
    assert updated.assignee_id == "other-user"
    assert "symphony:codex" in Enum.map(updated.labels, & &1.name)
  end

  test "does not replace an existing symphony label", %{project: project, parent: parent} do
    {:ok, _} = Context.update_issue("macro", parent.identifier, %{"agent" => "claude"})

    assert :ok = IssueDispatchPrep.ensure_dispatch_gates(project, parent.identifier, "codex")

    assert {:ok, updated} = Context.get_issue("macro", parent.identifier)
    assert updated.assignee_id == "raphaelcangucu"
    assert "symphony:claude" in Enum.map(updated.labels, & &1.name)
    refute "symphony:codex" in Enum.map(updated.labels, & &1.name)
  end

  test "prepare_for_dispatch applies gates to execution bundle child_run units", %{
    project: project,
    parent: parent,
    child: child
  } do
    {:ok, _} = Context.set_issue_parent("macro", child.identifier, parent.identifier)

    workpad_body = """
    ## Codex Workpad

    ### Execution bundle

    ```yaml
    version: 1
    mode: parallel
    parent: #{parent.identifier}
    units:
      - id: u1
        type: child_run
        issue: #{child.identifier}
        repo: clouapp/back
    ```
    """

    assert {:ok, _} =
             Context.add_comment("macro", parent.identifier, workpad_body, %{"author" => "assistant"})

    assert :ok = IssueDispatchPrep.prepare_for_dispatch(project, parent.identifier, "codex")

    assert {:ok, updated_parent} = Context.get_issue("macro", parent.identifier)
    assert updated_parent.assignee_id == "raphaelcangucu"
    assert "symphony:codex" in Enum.map(updated_parent.labels, & &1.name)

    assert {:ok, updated_child} = Context.get_issue("macro", child.identifier)
    assert updated_child.assignee_id == "raphaelcangucu"
    assert "symphony:codex" in Enum.map(updated_child.labels, & &1.name)
  end

  test "prepare_for_dispatch applies gates to linked subtasks without a bundle", %{
    project: project,
    parent: parent,
    child: child
  } do
    {:ok, _} = Context.set_issue_parent("macro", child.identifier, parent.identifier)

    assert :ok = IssueDispatchPrep.prepare_for_dispatch(project, parent.identifier, "codex")

    assert {:ok, updated_child} = Context.get_issue("macro", child.identifier)
    assert updated_child.assignee_id == "raphaelcangucu"
    assert "symphony:codex" in Enum.map(updated_child.labels, & &1.name)
  end

  defp migrate_repo do
    alias SymphonyElixir.Repo

    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
