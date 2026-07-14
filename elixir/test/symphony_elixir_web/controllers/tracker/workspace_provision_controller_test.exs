defmodule SymphonyElixirWeb.Tracker.WorkspaceProvisionControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workspace.Provision
  alias SymphonyElixir.{Repo, Workflow}

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @project_slug "provision-retry"
  @ensure_fun_env :workspace_provision_ensure_fun

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    previous_ensure_fun = Application.get_env(:symphony_elixir, @ensure_fun_env)

    workspace_root =
      Path.join(System.tmp_dir!(), "workspace-provision-controller-test-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace_root)
    workflow_file = Path.join(workspace_root, "WORKFLOW.md")
    write_workflow!(workflow_file, workspace_root: workspace_root)
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      restore_env(@token_env, previous_token)
      restore_ensure_fun(previous_ensure_fun)
      File.rm_rf!(workspace_root)
    end)

    {:ok, workspace_root: workspace_root}
  end

  test "provisions the workspace when it does not exist yet", %{workspace_root: root} do
    {:ok, issue} = create_project_and_issue()
    expected_path = Path.join([root, @project_slug, issue.identifier])

    conn = post(authorized_conn(), provision_path(issue.identifier))

    assert %{"data" => %{"workspace_path" => ^expected_path, "status" => "ready"}} = json_response(conn, 200)
    assert File.dir?(expected_path)
  end

  test "is idempotent: retrying after the workspace already exists still succeeds", %{workspace_root: root} do
    {:ok, issue} = create_project_and_issue()
    expected_path = Path.join([root, @project_slug, issue.identifier])
    path = provision_path(issue.identifier)

    assert %{"data" => %{"workspace_path" => ^expected_path}} = json_response(post(authorized_conn(), path), 200)

    assert %{"data" => %{"workspace_path" => ^expected_path, "status" => "ready"}} =
             json_response(post(authorized_conn(), path), 200)
  end

  test "returns issue_not_found for an unknown issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Provision Retry", slug: @project_slug})

    conn = post(authorized_conn(), provision_path("PRO-404"))

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "issue_not_found", "message" => "Issue not found"}
           }
  end

  test "returns project_not_found for an unknown project" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/does-not-exist/issues/X-1/workspace/provision")

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "project_not_found", "message" => "Project not found"}
           }
  end

  test "surfaces a structured, retryable error when provisioning hits a retryable failure" do
    Application.put_env(:symphony_elixir, @ensure_fun_env, fn _workspace, _issue_ref ->
      {:error,
       %Provision.Error{
         workspace: "/tmp/whatever",
         staging: "/tmp/whatever-staging",
         stage: :after_create,
         reason: {:workspace_hook_failed, "after_create", 1, "boom"},
         retryable: true
       }}
    end)

    {:ok, issue} = create_project_and_issue()

    conn = post(authorized_conn(), provision_path(issue.identifier))

    assert %{
             "error" => %{
               "code" => "workspace_provision_failed",
               "details" => %{"retryable" => true, "stage" => "after_create"}
             }
           } = json_response(conn, 503)
  end

  test "surfaces a non-retryable, incomplete-workspace error distinctly from a generic failure" do
    Application.put_env(:symphony_elixir, @ensure_fun_env, fn _workspace, _issue_ref ->
      {:error,
       %Provision.Error{
         workspace: "/tmp/whatever",
         stage: :inspect_final,
         reason: {:workspace_incomplete, "/tmp/whatever", :token_mismatch, :rolled_back},
         retryable: true
       }}
    end)

    {:ok, issue} = create_project_and_issue()

    conn = post(authorized_conn(), provision_path(issue.identifier))

    assert %{"error" => %{"code" => "workspace_provision_incomplete"}} = json_response(conn, 409)
  end

  defp create_project_and_issue do
    {:ok, _project} = Context.ensure_project(%{name: "Provision Retry", slug: @project_slug})
    Context.create_issue(@project_slug, %{"title" => "Needs a workspace", "status" => "Todo"})
  end

  defp provision_path(identifier) do
    "/api/tracker/v1/projects/#{@project_slug}/issues/#{identifier}/workspace/provision"
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp write_workflow!(path, overrides) do
    SymphonyElixir.TestSupport.write_workflow_file!(
      path,
      Keyword.merge([tracker_kind: "local"], overrides)
    )
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)

  defp restore_ensure_fun(nil), do: Application.delete_env(:symphony_elixir, @ensure_fun_env)
  defp restore_ensure_fun(value), do: Application.put_env(:symphony_elixir, @ensure_fun_env, value)
end
