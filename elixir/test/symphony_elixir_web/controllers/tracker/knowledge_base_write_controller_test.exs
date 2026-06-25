defmodule SymphonyElixirWeb.Tracker.KnowledgeBaseWriteControllerTest do
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

  test "PUT creates a page and returns the commit" do
    body = %{"frontmatter" => %{"title" => "New"}, "body" => "# New\n"}
    conn = put(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/new-page.md", body)
    data = json_response(conn, 200)["data"]
    assert data["path"] == "new-page.md"
    assert is_binary(data["commit"])
  end

  test "POST move renames a page" do
    put(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/old.md", %{
      "frontmatter" => %{},
      "body" => "x"
    })

    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/move", %{
        "from" => "old.md",
        "to" => "sub/new.md"
      })

    assert json_response(conn, 200)["data"]["path"] == "sub/new.md"
  end

  test "DELETE removes a page" do
    put(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/temp.md", %{
      "frontmatter" => %{},
      "body" => "x"
    })

    conn = delete(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/temp.md")
    assert json_response(conn, 200)["data"]["path"] == "temp.md"
  end

  test "POST asset stores an image and returns a relative link" do
    upload = %Plug.Upload{path: write_tmp_png(), filename: "logo.png", content_type: "image/png"}

    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/assets", %{
        "file" => upload,
        "page_path" => "index.md"
      })

    data = json_response(conn, 201)["data"]
    assert String.starts_with?(data["asset_path"], "assets/")
    assert data["markdown_link"] == data["asset_path"]
  end

  test "PUT with traversal path is rejected" do
    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/acme/kb/repos/web/pages/notes.txt", %{
        "frontmatter" => %{},
        "body" => "x"
      })

    assert json_response(conn, 422)["error"]["code"] == "kb_invalid_path"
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  defp write_tmp_png do
    p = Path.join(System.tmp_dir!(), "kb-#{System.unique_integer([:positive])}.png")
    File.write!(p, <<137, 80, 78, 71, 13, 10, 26, 10>>)
    p
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
  defp git(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)

  defp configure_isolated_workspace_root do
    root = Path.join(System.tmp_dir!(), "kb-wctrl-#{System.unique_integer([:positive])}")
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
