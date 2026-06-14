defmodule SymphonyElixirWeb.Tracker.EditorControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.TestSupport
  alias SymphonyElixir.Workflow
  alias SymphonyElixir.Workspace

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    workflow_root = hermetic_workflow!()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf(workflow_root)
    end)

    :ok
  end

  # Pin a hermetic WORKFLOW.md (no editor section -> editor disabled by default)
  # so the suite never reads a developer's local WORKFLOW.md that enables the
  # browser editor, which would otherwise make this test environment-dependent.
  defp hermetic_workflow! do
    workflow_root =
      Path.join(System.tmp_dir!(), "symphony-editor-workflow-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workflow_root)
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    TestSupport.write_workflow_file!(workflow_file)
    Workflow.set_workflow_file_path(workflow_file)

    workflow_root
  end

  test "returns disabled when the editor is off" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Editor issue", "status" => "Todo"})

    # The endpoint always reports a `cursor_desktop` target alongside the browser
    # editor. Its availability depends solely on whether the task workspace dir
    # exists on disk (and `WSL_DISTRO_NAME` only shapes the URL once available).
    # A leftover workspace from a prior run would flip it to `available: true`,
    # so remove any so the contract is deterministic regardless of the host env.
    workspace = Workspace.path_for_issue("MAC-1")
    File.rm_rf(workspace)
    refute File.dir?(workspace)

    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/editor")

    assert json_response(conn, 200) == %{
             "data" => %{
               "available" => false,
               "url" => nil,
               "reason" => "disabled",
               "cursor_desktop" => %{
                 "available" => false,
                 "url" => nil,
                 "reason" => "workspace_missing"
               }
             }
           }
  end

  test "returns 404 for an unknown issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-404/editor")

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "issue_not_found", "message" => "Issue not found"}
           }
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
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
