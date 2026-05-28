defmodule SymphonyElixirWeb.Tracker.DevEnvControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    {:ok, _r, _a} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
    for t <- ["local_tracker_dev_env_step_runs", "local_tracker_dev_env_runs", "local_tracker_dev_env_steps", "local_tracker_projects"], do: Repo.query!("delete from #{t}")

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "P",
        "slug" => "p",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [],
        "setup" => %{}
      })

    previous = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    on_exit(fn -> if previous, do: System.put_env(@token_env, previous), else: System.delete_env(@token_env) end)
    :ok
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  test "save and list steps" do
    save =
      put(authorized_conn(), "/api/tracker/v1/projects/p/dev_env/steps", %{
        "steps" => [%{"description" => "Install", "command" => "mix deps.get", "source" => "manual"}]
      })

    assert %{"data" => [%{"command" => "mix deps.get", "position" => 0}]} = json_response(save, 200)

    list = get(authorized_conn(), "/api/tracker/v1/projects/p/dev_env/steps")
    assert %{"data" => [%{"description" => "Install"}]} = json_response(list, 200)
  end

  test "propose returns proposals (empty project)" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/p/dev_env/propose", %{})
    assert %{"data" => proposals} = json_response(conn, 200)
    assert is_list(proposals)
  end
end
