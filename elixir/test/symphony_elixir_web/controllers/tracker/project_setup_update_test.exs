defmodule SymphonyElixirWeb.Tracker.ProjectSetupUpdateTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
    clean_repo()

    previous = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    on_exit(fn -> if previous, do: System.put_env(@token_env, previous), else: System.delete_env(@token_env) end)
    :ok
  end

  test "PUT /projects/:id/setup upserts setup and returns the project DTO" do
    {:ok, _project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/alpha/setup", %{
        "setup" => %{
          "prompt_template" => "Hello",
          "workflow_config" => %{"tracker" => %{"active_states" => ["Todo"]}}
        }
      })

    assert %{"data" => %{"setup" => %{"prompt_template" => "Hello"}}} = json_response(conn, 200)
  end

  test "PUT /projects/:id/setup rejects an invalid workflow_config with 422 and does not persist" do
    {:ok, _project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/alpha/setup", %{
        "setup" => %{
          "prompt_template" => "Hello",
          "workflow_config" => "not-a-map"
        }
      })

    body = json_response(conn, 422)
    assert body["error"]["code"] == "validation_failed"
    assert body["error"]["message"] =~ "invalid workflow_config"

    setup = Context.get_project_setup("alpha")
    assert is_nil(setup) or setup.workflow_config == %{}
    refute setup && setup.prompt_template == "Hello"
  end

  test "PUT /projects/:id/setup returns 404 for unknown project" do
    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/nope/setup", %{
        "setup" => %{"prompt_template" => "Hello"}
      })

    assert json_response(conn, 404)["error"]["code"] == "project_not_found"
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
