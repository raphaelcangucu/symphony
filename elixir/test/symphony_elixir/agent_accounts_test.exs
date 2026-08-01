defmodule SymphonyElixir.AgentAccountsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentAccounts
  alias SymphonyElixir.AgentLifecycle.Paths

  setup do
    root = Path.join(System.tmp_dir!(), "agent-accounts-#{System.unique_integer([:positive])}")
    previous = Application.get_env(:symphony_elixir, :agent_data_dir)
    Application.put_env(:symphony_elixir, :agent_data_dir, root)

    on_exit(fn ->
      File.rm_rf(root)

      if previous do
        Application.put_env(:symphony_elixir, :agent_data_dir, previous)
      else
        Application.delete_env(:symphony_elixir, :agent_data_dir)
      end
    end)

    :ok
  end

  test "creates distinct provider homes and atomically persists metadata" do
    assert {:ok, first} =
             AgentAccounts.create("codex", %{
               id: "personal",
               label: "Personal",
               authentication_status: "authenticated"
             })

    assert {:ok, second} =
             AgentAccounts.create("codex", %{
               id: "work",
               label: "Work",
               authentication_status: "authenticated"
             })

    assert first.home != second.home
    assert File.dir?(first.home)
    assert File.dir?(second.home)
    assert {:ok, decoded} = Paths.accounts_manifest("codex") |> File.read!() |> Jason.decode()
    assert Enum.map(decoded["accounts"], & &1["id"]) == ["personal", "work"]
    assert Path.wildcard(Paths.accounts_manifest("codex") <> ".tmp-*") == []
  end

  test "resolves request, project, global default, then first authenticated account" do
    {:ok, personal} =
      AgentAccounts.create("claude", %{
        id: "personal",
        label: "Personal",
        authentication_status: "authenticated"
      })

    {:ok, _work} =
      AgentAccounts.create("claude", %{
        id: "work",
        label: "Work",
        authentication_status: "authenticated"
      })

    assert {:ok, ^personal} = AgentAccounts.resolve("claude", nil, nil)
    assert {:ok, _account} = AgentAccounts.set_default("claude", "work")
    assert {:ok, %{id: "work", default: true}} = AgentAccounts.resolve("claude", nil, nil)
    assert {:ok, %{id: "personal"}} = AgentAccounts.resolve("claude", "personal", nil)
    assert {:ok, %{id: "work"}} = AgentAccounts.resolve("claude", "personal", "work")
  end

  test "does not select unauthenticated accounts and returns a useful error" do
    {:ok, _account} =
      AgentAccounts.create("cursor", %{
        id: "signed-out",
        label: "Signed out",
        authentication_status: "unauthenticated"
      })

    assert {:error, :no_authenticated_account} = AgentAccounts.resolve("cursor", nil, nil)

    assert {:error, {:account_not_eligible, "signed-out"}} =
             AgentAccounts.resolve("cursor", nil, "signed-out")
  end

  test "presentation and persisted records exclude supplied secrets" do
    {:ok, account} =
      AgentAccounts.create("opencode", %{
        id: "safe",
        label: "Safe",
        authentication_status: "authenticated",
        access_token: "must-not-persist",
        refresh_token: "must-not-persist"
      })

    presented = AgentAccounts.present(account)
    refute Map.has_key?(presented, :home)
    refute Map.has_key?(presented, :access_token)
    refute Map.has_key?(presented, :refresh_token)

    contents = File.read!(Paths.accounts_manifest("opencode"))
    refute String.contains?(contents, "must-not-persist")
  end
end
