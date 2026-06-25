defmodule SymphonyElixir.KnowledgeBase.SyncWorkerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.{SyncState, SyncWorker}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(SyncState) end)
    :ok
  end

  test "a successful run records merged state and broadcasts" do
    Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, "project:acme")

    flow = %{
      resolve: fn "acme", "web" ->
        {:ok, %{repo: "acme/web", default_branch: "main", project: :proj, ws: %{}}}
      end,
      sync: fn _ws, "main", _ -> {:ok, :merged} end,
      ensure_pr: fn "acme/web", "symphony-docs", _ -> {:ok, %{number: 5, url: "u", created: true}} end,
      evaluate: fn _ctx, 5, _ -> {:ok, :merged} end
    }

    {:ok, pid} = SyncWorker.start_link(project_slug: "acme", repo_slug: "web", flow: flow, name: nil)
    assert :ok = SyncWorker.run_now(pid)

    assert SyncState.get("acme", "web").status == "merged"
    assert_receive {:tracker_event, "kb_sync_updated", %{status: "merged"}}, 1_000
  end

  test "a merge conflict records conflict state and does not crash" do
    flow = %{
      resolve: fn _, _ ->
        {:ok, %{repo: "acme/web", default_branch: "main", project: :proj, ws: %{}}}
      end,
      sync: fn _ws, "main", _ -> {:error, :merge_conflict} end,
      ensure_pr: fn _, _, _ -> flunk("should not reach PR step") end,
      evaluate: fn _, _, _ -> flunk("should not evaluate") end
    }

    {:ok, pid} = SyncWorker.start_link(project_slug: "acme", repo_slug: "web", flow: flow, name: nil)
    assert :ok = SyncWorker.run_now(pid)
    assert SyncState.get("acme", "web").status == "conflict"
  end

  test "pending checks reschedule a recheck without looping forever" do
    flow = %{
      resolve: fn _, _ ->
        {:ok, %{repo: "acme/web", default_branch: "main", project: :proj, ws: %{}}}
      end,
      sync: fn _ws, "main", _ -> {:ok, :merged} end,
      ensure_pr: fn _, _, _ -> {:ok, %{number: 8, url: "u", created: true}} end,
      evaluate: fn _, 8, _ -> {:ok, :pending} end
    }

    {:ok, pid} =
      SyncWorker.start_link(
        project_slug: "acme",
        repo_slug: "web",
        flow: flow,
        reschedule: false,
        name: nil
      )

    assert :ok = SyncWorker.run_now(pid)
    assert SyncState.get("acme", "web").status == "open_pr"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
