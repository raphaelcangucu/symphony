defmodule SymphonyElixirWeb.Tracker.KnowledgeBaseGeneralControllerTest do
  use ExUnit.Case, async: false
  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.KnowledgeBase.PageRecord
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

    origin = Path.join(root, "origin")
    File.mkdir_p!(Path.join(origin, "docs"))
    File.write!(Path.join(origin, "docs/keep.md"), "---\ntitle: Keep\n---\n# Keep\n")
    git(origin, ["init", "-q", "-b", "main"])
    git(origin, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"])
    git(origin, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"])

    deps = [
      ensure_repo: fn ->
        {:ok,
         %{full_name: "octocat/symphony-kb", clone_url: origin, default_branch: "main", created: false}}
      end,
      clone: fn _clone_url, dest ->
        {_o, 0} = System.cmd("git", ["clone", "-q", origin, dest], stderr_to_stdout: true)
        {:ok, dest}
      end
    ]

    Application.put_env(:symphony_elixir, :kb_general_deps, deps)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :kb_general_deps) end)
    :ok
  end

  test "POST connect then GET overview exposes the page tree" do
    conn = post(authorized_conn(), "/api/tracker/v1/kb/connect")
    assert json_response(conn, 200)["data"]["connected"] == true

    conn = get(authorized_conn(), "/api/tracker/v1/kb")
    tree = json_response(conn, 200)["data"]["tree"]
    assert Enum.any?(tree, &(&1["path"] == "keep.md"))
  end

  test "PUT page then GET page round-trips general KB content" do
    post(authorized_conn(), "/api/tracker/v1/kb/connect")

    put(authorized_conn(), "/api/tracker/v1/kb/pages/notes/idea.md", %{
      "frontmatter" => %{"title" => "Idea"},
      "body" => "a unique vicuna plan"
    })

    conn = get(authorized_conn(), "/api/tracker/v1/kb/pages/notes/idea.md")
    page = json_response(conn, 200)["data"]
    assert page["title"] == "Idea"
    assert page["body"] =~ "vicuna"

    assert Enum.any?(Repo.all(PageRecord), &(&1.path == "notes/idea.md"))
  end

  test "POST home regenerates the index page" do
    post(authorized_conn(), "/api/tracker/v1/kb/connect")
    conn = post(authorized_conn(), "/api/tracker/v1/kb/home")
    assert json_response(conn, 200)["data"]["path"] == "index.md"
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
    root = Path.join(System.tmp_dir!(), "kb-genctrl-#{System.unique_integer([:positive])}")
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
