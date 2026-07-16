defmodule SymphonyElixir.DevServer.RuntimeContractStoreTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DevServer.{RuntimeContract, RuntimeContractStore}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "P",
        "slug" => "p",
        "workflow_statuses" => [
          %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
        ],
        "repositories" => [],
        "setup" => %{}
      })

    %{project: project}
  end

  defp offer(overrides \\ %{}) do
    Map.merge(
      %{
        issue_identifier: "1131",
        server_slug: "advising",
        source: :managed,
        preferred_port: 4300,
        allowed_ports: [4300, 4302, 4304],
        report_path: "/tmp/ws/.symphony/preview-report.json",
        ready_probe: "http",
        ready_path: "/",
        url_path: "/",
        port_env: "INSPIRE_PORT"
      },
      overrides
    )
  end

  test "put persists a new contract and round-trips the allowed ports array", %{project: project} do
    assert {:ok, %RuntimeContract{} = contract} = RuntimeContractStore.put(project, offer())
    assert contract.revision == 1
    assert String.starts_with?(contract.contract_id, "ctr_")
    assert contract.allowed_ports == [4300, 4302, 4304]

    assert {:ok, reloaded, _record} =
             RuntimeContractStore.get_active(project, "1131", "advising")

    assert reloaded.contract_id == contract.contract_id
    assert reloaded.allowed_ports == [4300, 4302, 4304]
    assert reloaded.source == :managed
  end

  test "put is idempotent for an unchanged offer", %{project: project} do
    {:ok, first} = RuntimeContractStore.put(project, offer())
    {:ok, second} = RuntimeContractStore.put(project, offer())

    assert first.contract_id == second.contract_id
    assert first.revision == second.revision
  end

  test "put rotates the revision but keeps the contract id when the offer changes", %{project: project} do
    {:ok, first} = RuntimeContractStore.put(project, offer())
    {:ok, second} = RuntimeContractStore.put(project, offer(%{allowed_ports: [4300, 4306, 4308]}))

    assert second.contract_id == first.contract_id
    assert second.revision == first.revision + 1
    assert second.allowed_ports == [4300, 4306, 4308]
  end

  test "delete_for_issue removes all contracts for the issue", %{project: project} do
    {:ok, _} = RuntimeContractStore.put(project, offer())
    {:ok, _} = RuntimeContractStore.put(project, offer(%{server_slug: "api", preferred_port: 4310, allowed_ports: [4310]}))

    assert :ok = RuntimeContractStore.delete_for_issue(project.id, "1131")
    assert RuntimeContractStore.get_active(project, "1131", "advising") == :error
    assert RuntimeContractStore.list_for_issue(project.id, "1131") == []
  end

  test "put rejects a missing server slug", %{project: project} do
    assert {:error, {:missing, :server_slug}} =
             RuntimeContractStore.put(project, offer(%{server_slug: nil}))
  end
end
