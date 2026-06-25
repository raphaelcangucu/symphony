defmodule SymphonyElixir.DevServer.LeaseStoreTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DevServer.LeaseStore
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()

    {:ok, project_a} = create_project("a")
    {:ok, project_b} = create_project("b")

    {:ok, project_a: project_a, project_b: project_b}
  end

  test "ensure_band assigns the lowest free index and is stable", %{project_a: a, project_b: b} do
    assert {:ok, 0} = LeaseStore.ensure_band(a.id, 78)
    assert {:ok, 0} = LeaseStore.ensure_band(a.id, 78)
    assert {:ok, 1} = LeaseStore.ensure_band(b.id, 78)
  end

  test "ensure_band returns no_free_band when the pool is exhausted", %{
    project_a: a,
    project_b: b
  } do
    assert {:ok, 0} = LeaseStore.ensure_band(a.id, 1)
    assert {:error, :no_free_band} = LeaseStore.ensure_band(b.id, 1)
  end

  test "ensure_slot assigns lowest free per project and is stable per issue", %{project_a: a} do
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 32)
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 32)
    assert {:ok, 1} = LeaseStore.ensure_slot(a.id, "2", 32)
  end

  test "ensure_slot reuses a freed index after release", %{project_a: a} do
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 32)
    assert {:ok, 1} = LeaseStore.ensure_slot(a.id, "2", 32)
    assert :ok = LeaseStore.release_slot(a.id, "1")
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "3", 32)
  end

  test "ensure_slot returns no_free_slot when the band is full", %{project_a: a} do
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 1)
    assert {:error, :no_free_slot} = LeaseStore.ensure_slot(a.id, "2", 1)
  end

  test "ensure_slot returns no_free_slot when zero slots are available", %{project_a: a} do
    assert {:error, :no_free_slot} = LeaseStore.ensure_slot(a.id, "1", 0)
  end

  test "slot_for_issue reflects current lease state", %{project_a: a} do
    assert :error = LeaseStore.slot_for_issue(a.id, "1")
    assert {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 32)
    assert {:ok, 0} = LeaseStore.slot_for_issue(a.id, "1")
    assert :ok = LeaseStore.release_slot(a.id, "1")
    assert :error = LeaseStore.slot_for_issue(a.id, "1")
  end

  test "leased_issue_slots lists every active lease with project and identifier", %{
    project_a: a,
    project_b: b
  } do
    {:ok, 0} = LeaseStore.ensure_slot(a.id, "1", 32)
    {:ok, 0} = LeaseStore.ensure_slot(b.id, "9", 32)

    pairs =
      LeaseStore.leased_issue_slots()
      |> Enum.map(fn {project_id, identifier, _inserted_at} -> {project_id, identifier} end)
      |> Enum.sort()

    assert pairs == Enum.sort([{a.id, "1"}, {b.id, "9"}])
  end

  defp create_project(slug) do
    Context.create_workspace_project(%{
      "name" => String.upcase(slug),
      "slug" => slug,
      "workflow_statuses" => [
        %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
      ],
      "repositories" => [],
      "setup" => %{}
    })
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)
end
