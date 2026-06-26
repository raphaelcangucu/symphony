defmodule SymphonyElixir.KnowledgeBaseTestFixtures do
  @moduledoc """
  Seeds a project plus one or more repositories with a committed `docs/`
  checkout under an isolated workspace root. Shared by the KB assistant-tool
  and executor suites so they exercise real git checkouts the same way the
  M1/M2 KB tests do.
  """

  alias SymphonyElixir.LocalTracker.{Context, Repository}
  alias SymphonyElixir.Repo

  @spec reset!() :: :ok
  def reset! do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    :ok
  end

  @doc """
  Seeds project `project_slug` with a single repository (`github_full_name`)
  whose `docs/` tree is committed on `main`. Returns context including a
  `:cleanup` function the caller should register with `on_exit/1`.
  """
  @spec seed_single_repo_project(String.t(), String.t(), keyword()) :: {:ok, map()}
  def seed_single_repo_project(project_slug, github_full_name, opts \\ []) do
    workspace_path = Keyword.get(opts, :workspace_path, default_workspace_path(github_full_name))
    root = configure_workspace_root(project_slug)

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => project_slug,
        "slug" => project_slug,
        "tracker" => %{"kind" => "local"},
        "repositories" => [
          %{"github_full_name" => github_full_name, "workspace_path" => workspace_path, "role" => "backend"}
        ],
        "setup" => %{}
      })

    checkout = seed_checkout!(root, project_slug, workspace_path)

    {:ok,
     %{
       root: root,
       checkout: checkout,
       project_slug: project_slug,
       workspace_path: workspace_path,
       cleanup: fn ->
         File.rm_rf(root)
         Application.delete_env(:symphony_elixir, :workflow_file_path)
       end
     }}
  end

  @doc "Adds another repository to an existing project (DB row only by default)."
  @spec add_repo(String.t(), String.t(), keyword()) :: {:ok, Repository.t()}
  def add_repo(project_slug, github_full_name, opts \\ []) do
    workspace_path = Keyword.get(opts, :workspace_path, default_workspace_path(github_full_name))
    {:ok, project} = Context.get_project(project_slug)

    {:ok, _repo} =
      %Repository{}
      |> Repository.changeset(%{
        project_id: project.id,
        github_full_name: github_full_name,
        workspace_path: workspace_path,
        role: "backend"
      })
      |> Repo.insert()
  end

  defp seed_checkout!(root, project_slug, workspace_path) do
    checkout = Path.join([root, project_slug, workspace_path])
    File.mkdir_p!(Path.join(checkout, "docs"))
    File.write!(Path.join(checkout, "docs/index.md"), "---\ntitle: Home\n---\n# Home\n")
    git!(checkout, ["init", "-q", "-b", "main"])
    git!(checkout, ["add", "-A"])
    git!(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed docs"])
    checkout
  end

  defp configure_workspace_root(project_slug) do
    root = Path.join(System.tmp_dir!(), "kb-fixtures-#{project_slug}-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    workflow = Path.join(root, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow, workspace_root: root)
    SymphonyElixir.Workflow.set_workflow_file_path(workflow)
    root
  end

  defp default_workspace_path(github_full_name) do
    github_full_name |> String.split("/") |> List.last()
  end

  defp git!(dir, args) do
    {_out, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
    :ok
  end
end
