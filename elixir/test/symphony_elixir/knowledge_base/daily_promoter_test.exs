defmodule SymphonyElixir.KnowledgeBase.DailyPromoterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.DailyPromoter
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    root = configure_isolated_workspace_root()

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

    {:ok, root: root}
  end

  test "skips repositories that are not checked out (never clones)" do
    parent = self()

    pid =
      start_supervised!(
        {DailyPromoter, name: :kb_promoter_skip, promote: fn p, r -> send(parent, {:promoted, p, r}); :ok end}
      )

    assert {:ok, 0} = DailyPromoter.promote_now(pid)
    refute_received {:promoted, _, _}
  end

  test "promotes repositories that are checked out locally", %{root: root} do
    checkout = Path.join([root, "acme", "web"])
    File.mkdir_p!(Path.join(checkout, "docs"))
    git(checkout, ["init", "-q", "-b", "main"])

    parent = self()

    pid =
      start_supervised!(
        {DailyPromoter, name: :kb_promoter_run, promote: fn p, r -> send(parent, {:promoted, p, r}); :ok end}
      )

    assert {:ok, 1} = DailyPromoter.promote_now(pid)
    assert_received {:promoted, "acme", "web"}
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  defp git(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)

  defp configure_isolated_workspace_root do
    root = Path.join(System.tmp_dir!(), "kb-promoter-#{System.unique_integer([:positive])}")
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
