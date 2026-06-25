defmodule SymphonyElixirWeb.Tracker.KnowledgeBaseSyncControllerTest do
  use ExUnit.Case, async: false
  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()
    root = configure_isolated_workspace_root()

    token_env = SymphonyElixir.Config.local_api_token_env()
    previous_token = System.get_env(token_env)
    System.put_env(token_env, "secret")
    on_exit(fn -> restore_env(token_env, previous_token) end)

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Acme",
        "slug" => "acme",
        "tracker" => %{"kind" => "local"},
        "repositories" => [
          %{"github_full_name" => "acme/web", "workspace_path" => "web", "role" => "frontend"}
        ],
        "setup" => %{}
      })

    checkout = Path.join([root, "acme", "web"])
    File.mkdir_p!(Path.join(checkout, "docs"))
    File.write!(Path.join(checkout, "docs/index.md"), "---\ntitle: Home\n---\n# Home\n")
    git(checkout, ["init", "-q", "-b", "main"])
    git(checkout, ["add", "-A"])
    git(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed docs"])
    :ok
  end

  test "GET sync returns idle status for a fresh repo" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/sync")
    assert json_response(conn, 200)["data"]["status"] == "idle"
  end

  test "POST sync accepts the request" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/sync")
    assert response(conn, 202)
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
  defp git(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)

  defp configure_isolated_workspace_root do
    root = Path.join(System.tmp_dir!(), "kb-syncctrl-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    workflow = Path.join(root, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow, workspace_root: root)
    SymphonyElixir.Workflow.set_workflow_file_path(workflow)

    on_exit(fn ->
      File.rm_rf(root)
      Application.delete_env(:symphony_elixir, :workflow_file_path)
    end)

    root
  end
end
