defmodule SymphonyElixirWeb.Tracker.IssueDocumentControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.TestSupport
  alias SymphonyElixir.Workflow

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @project_slug "macro-markets"
  @workflow_statuses [
    %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
  ]

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    test_root = Path.join(System.tmp_dir!(), "symphony-issue-document-controller-#{System.unique_integer([:positive])}")
    workflow_root = Path.join(test_root, "workflow")
    workspace_root = Path.join(test_root, "workspaces")
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    previous_workflow_path = Workflow.workflow_file_path()

    File.mkdir_p!(workflow_root)
    File.mkdir_p!(workspace_root)
    TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: workspace_root)
    Workflow.set_workflow_file_path(workflow_file)

    migrate_repo()
    clean_repo()

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Macro Markets",
        "slug" => @project_slug,
        "workflow_statuses" => @workflow_statuses,
        "repositories" => [],
        "setup" => %{}
      })

    {:ok, issue} = Context.create_issue(@project_slug, %{"title" => "Document review", "status" => "Todo"})
    doc_path = write_issue_document!(workspace_root, issue.identifier, "x.md", "# X Design\n\ncontent")

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      Workflow.set_workflow_file_path(previous_workflow_path)
      File.rm_rf!(test_root)
    end)

    {:ok, identifier: issue.identifier, doc_path: doc_path}
  end

  test "lists available issue authoring documents", %{identifier: identifier} do
    conn = get(authorized_conn(), documents_path(identifier))

    assert %{
             "data" => %{
               "available" => true,
               "reason" => nil,
               "documents" => [
                 %{
                   "id" => "docs/superpowers/specs/x.md",
                   "kind" => "spec",
                   "path" => "docs/superpowers/specs/x.md",
                   "title" => "X Design",
                   "updated_at" => updated_at
                 }
               ]
             }
           } = json_response(conn, 200)

    assert is_binary(updated_at)
  end

  test "reads an issue authoring document", %{identifier: identifier} do
    conn = get(authorized_conn(), document_path(identifier, "docs/superpowers/specs/x.md"))

    assert json_response(conn, 200) == %{
             "data" => %{
               "path" => "docs/superpowers/specs/x.md",
               "content" => "# X Design\n\ncontent"
             }
           }
  end

  test "rejects traversal outside the issue document root", %{identifier: identifier} do
    conn = get(authorized_conn(), document_path(identifier, "docs/superpowers/../secret.md"))

    assert %{"error" => %{"code" => "invalid_issue_document_path"}} = json_response(conn, 422)
  end

  test "returns not found for a missing issue document", %{identifier: identifier} do
    conn = get(authorized_conn(), document_path(identifier, "docs/superpowers/specs/missing.md"))

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "issue_document_not_found", "message" => "Issue document not found"}
           }
  end

  defp write_issue_document!(workspace_root, identifier, filename, content) do
    specs_dir = Path.join([workspace_root, identifier, "docs", "superpowers", "specs"])
    File.mkdir_p!(specs_dir)
    path = Path.join(specs_dir, filename)
    File.write!(path, content)
    path
  end

  defp documents_path(identifier) do
    "/api/tracker/v1/projects/#{@project_slug}/issues/#{identifier}/documents"
  end

  defp document_path(identifier, rel_path) do
    "#{documents_path(identifier)}/#{rel_path}"
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_dev_servers",
          "local_tracker_dev_env_step_runs",
          "local_tracker_dev_env_runs",
          "local_tracker_dev_env_steps",
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_repositories",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
