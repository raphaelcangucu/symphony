defmodule SymphonyElixirWeb.Tracker.KnowledgeBaseControllerTest do
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
    File.mkdir_p!(Path.join(checkout, "docs/architecture"))
    File.write!(Path.join(checkout, "docs/index.md"), "---\ntitle: Home\n---\n# Home\n")
    File.write!(Path.join(checkout, "docs/architecture/backend.md"), "---\ntitle: Backend\n---\n# B\n")
    git(checkout, ["init", "-q", "-b", "main"])
    git(checkout, ["add", "-A"])
    git(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed docs"])
    :ok
  end

  defp git(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)

  test "rejects missing tracker bearer token" do
    conn = get(build_conn(), "/api/tracker/v1/projects/acme/kb")
    assert json_response(conn, 401)
  end

  test "GET project overview lists repositories" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb")
    body = json_response(conn, 200)
    assert body["data"]["project"]["slug"] == "acme"
    assert [%{"repo_slug" => "web", "docs_present?" => true}] = body["data"]["repositories"]
  end

  test "GET repo tree returns the docs tree" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web")
    body = json_response(conn, 200)
    assert body["data"]["repository"]["repo_slug"] == "web"
    names = Enum.map(body["data"]["tree"], & &1["name"])
    assert "index.md" in names
    assert "architecture" in names
  end

  test "GET page returns frontmatter, title, and body" do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/acme/kb/repos/web/pages/architecture/backend.md"
      )

    body = json_response(conn, 200)
    assert body["data"]["title"] == "Backend"
    assert body["data"]["path"] == "architecture/backend.md"
  end

  test "GET unknown repo returns 404" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/missing")
    assert json_response(conn, 404)["error"]["code"] == "repo_not_found"
  end

  test "GET traversal path returns 422" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/secret.txt")
    assert json_response(conn, 422)["error"]["code"] == "kb_invalid_path"
  end

  test "GET issue repo tree returns 404 when the worktree has no git checkout" do
    issue_root = Path.join(System.tmp_dir!(), "kb-issue-no-git-#{System.unique_integer([:positive])}")
    repo_root = Path.join(issue_root, "web")
    File.mkdir_p!(Path.join(repo_root, "docs"))
    File.write!(Path.join(repo_root, "docs/index.md"), "# Index\n")

    alias SymphonyElixir.Assistant.History

    {:ok, _thread} = History.ensure_issue_thread("acme", "MAC-NO-GIT", %{workspace_path: issue_root})

    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/acme/issues/MAC-NO-GIT/kb/repos/web"
      )

    assert json_response(conn, 404)["error"]["code"] == "repo_not_checked_out"

    on_exit(fn -> File.rm_rf(issue_root) end)
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)

  defp configure_isolated_workspace_root do
    root = Path.join(System.tmp_dir!(), "kb-ctrl-#{System.unique_integer([:positive])}")
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
