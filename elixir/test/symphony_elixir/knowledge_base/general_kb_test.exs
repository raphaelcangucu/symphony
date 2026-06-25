defmodule SymphonyElixir.KnowledgeBase.GeneralKbTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.{GeneralKb, PageRecord, Paths}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(PageRecord) end)

    root = configure_isolated_workspace_root()

    # A local "remote" the clone step copies from (offline).
    origin = Path.join(root, "origin")
    File.mkdir_p!(Path.join(origin, "docs"))
    File.write!(Path.join(origin, "docs/keep.md"), "---\ntitle: Keep\n---\n# Keep\n")
    sh(origin, ["init", "-q", "-b", "main"])
    sh(origin, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"])
    sh(origin, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"])

    deps = [
      ensure_repo: fn ->
        {:ok,
         %{
           full_name: "octocat/symphony-kb",
           clone_url: origin,
           default_branch: "main",
           created: false
         }}
      end,
      clone: fn _clone_url, dest ->
        {_o, 0} = System.cmd("git", ["clone", "-q", origin, dest], stderr_to_stdout: true)
        {:ok, dest}
      end
    ]

    {:ok, deps: deps}
  end

  test "connect clones the repo and exposes the tree", %{deps: deps} do
    assert {:ok, _} = GeneralKb.connect(deps)
    assert {:ok, overview} = GeneralKb.overview(deps)
    assert Enum.any?(overview.tree, &(&1.path == "keep.md"))
  end

  test "regenerate_home writes a generated index linking known projects", %{deps: deps} do
    {:ok, _} = GeneralKb.connect(deps)
    projects_fun = fn -> [%{name: "Acme", slug: "acme"}] end
    assert {:ok, result} = GeneralKb.regenerate_home(Keyword.put(deps, :projects, projects_fun))
    assert result.path == "index.md"

    {:ok, page} = GeneralKb.read_page("index.md", deps)
    assert page.body =~ "[Acme](/projects/acme/kb)"
  end

  test "write_page persists and indexes a general KB page", %{deps: deps} do
    {:ok, _} = GeneralKb.connect(deps)

    {:ok, _} =
      GeneralKb.write_page(
        "notes/idea.md",
        %{frontmatter: %{"title" => "Idea"}, body: "a wombat plan"},
        deps
      )

    assert Enum.any?(
             Repo.all(PageRecord),
             &(&1.project_slug == Paths.user_scope() and &1.path == "notes/idea.md")
           )
  end

  defp sh(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp configure_isolated_workspace_root do
    root = Path.join(System.tmp_dir!(), "kb-gen-#{System.unique_integer([:positive])}")
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
