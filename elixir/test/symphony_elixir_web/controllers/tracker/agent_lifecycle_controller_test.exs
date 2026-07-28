defmodule SymphonyElixirWeb.Tracker.AgentLifecycleControllerTest.FakeInstaller do
  def install_latest(agent, _options) do
    {:ok,
     %{
       status: :activated,
       version: "fixture-1.0.0",
       executable_path: "/fixture/#{agent}"
     }}
  end
end

defmodule SymphonyElixirWeb.Tracker.AgentLifecycleControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.AgentUsage.Snapshot
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    root = Path.join(System.tmp_dir!(), "agent-api-#{System.unique_integer([:positive])}")
    previous_root = Application.get_env(:symphony_elixir, :agent_data_dir)
    previous_installer = Application.get_env(:symphony_elixir, :agent_installer)
    previous_token = System.get_env(@token_env)

    Application.put_env(:symphony_elixir, :agent_data_dir, root)

    Application.put_env(
      :symphony_elixir,
      :agent_installer,
      SymphonyElixirWeb.Tracker.AgentLifecycleControllerTest.FakeInstaller
    )

    System.put_env(@token_env, "test-token")
    Repo.delete_all(Setting)
    AgentUsage.reset()

    on_exit(fn ->
      File.rm_rf(root)
      Repo.delete_all(Setting)
      AgentUsage.reset()
      restore_app_env(:agent_data_dir, previous_root)
      restore_app_env(:agent_installer, previous_installer)
      restore_env(previous_token)
    end)

    :ok
  end

  test "selects managed or PATH source without changing the other lifecycle preferences" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/agents/codex/source", %{"source" => "path"})

    assert %{
             "data" => %{
               "preferred_source" => "path",
               "auto_update" => true,
               "failover_enabled" => false
             }
           } = json_response(conn, 200)
  end

  test "install, update, and repair return structured operation state" do
    for operation <- ~w(install update repair) do
      conn = post(authed_conn(), "/api/tracker/v1/settings/agents/codex/#{operation}", %{})

      assert %{
               "data" => %{
                 "operation" => ^operation,
                 "status" => "activated",
                 "version" => "fixture-1.0.0"
               }
             } = json_response(conn, 200)
    end
  end

  test "account CRUD, default selection, and presentation are redacted" do
    assert Phoenix.Logger.filter_values(%{"access_token" => "never-return"}) == %{
             "access_token" => "[FILTERED]"
           }

    conn =
      post(authed_conn(), "/api/tracker/v1/settings/agents/claude/accounts", %{
        "id" => "work",
        "label" => "Work",
        "authentication_status" => "authenticated",
        "access_token" => "never-return"
      })

    assert %{"data" => account} = json_response(conn, 201)
    assert account["id"] == "work"
    refute Map.has_key?(account, "home")
    refute Map.has_key?(account, "access_token")

    conn =
      put(authed_conn(), "/api/tracker/v1/settings/agents/claude/accounts/work", %{
        "label" => "Work account"
      })

    assert %{"data" => %{"label" => "Work account"}} = json_response(conn, 200)

    conn =
      put(
        authed_conn(),
        "/api/tracker/v1/settings/agents/claude/accounts/work/default",
        %{}
      )

    assert %{"data" => %{"id" => "work", "default" => true}} = json_response(conn, 200)

    AgentUsage.put("claude", "work", %Snapshot{agent_kind: "claude", plan: "team"})
    conn = get(authed_conn(), "/api/tracker/v1/settings/agents/claude/accounts")
    assert %{"data" => %{"accounts" => [listed]}} = json_response(conn, 200)
    assert listed["usage"]["plan"] == "team"

    conn = delete(authed_conn(), "/api/tracker/v1/settings/agents/claude/accounts/work")
    assert response(conn, 204)
  end

  test "toggles failover independently and defaults to disabled" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/agents/cursor/failover", %{"enabled" => true})
    assert %{"data" => %{"failover_enabled" => true}} = json_response(conn, 200)
  end

  test "rejects unknown providers and invalid source values" do
    conn = put(authed_conn(), "/api/tracker/v1/settings/agents/nope/source", %{"source" => "path"})
    assert json_response(conn, 404)["error"]["code"] == "agent_not_found"

    conn = put(authed_conn(), "/api/tracker/v1/settings/agents/codex/source", %{"source" => "global"})
    assert json_response(conn, 422)["error"]["code"] == "validation_failed"
  end

  defp authed_conn do
    build_conn() |> put_req_header("authorization", "Bearer test-token")
  end

  defp restore_env(nil), do: System.delete_env(@token_env)
  defp restore_env(value), do: System.put_env(@token_env, value)

  defp restore_app_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_app_env(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
