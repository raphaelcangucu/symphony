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

  test "PUT /projects/:id/setup rejects a malformed value inside workflow_config with 422" do
    {:ok, _project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/alpha/setup", %{
        "setup" => %{
          "prompt_template" => "Hello",
          "workflow_config" => %{"tracker" => %{"active_states" => 123}}
        }
      })

    body = json_response(conn, 422)
    assert body["error"]["code"] == "validation_failed"
    assert body["error"]["message"] =~ "tracker.active_states"

    setup = Context.get_project_setup("alpha")
    assert is_nil(setup) or setup.workflow_config == %{}
  end

  test "PUT /projects/:id/setup returns 404 for unknown project" do
    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/nope/setup", %{
        "setup" => %{"prompt_template" => "Hello"}
      })

    assert json_response(conn, 404)["error"]["code"] == "project_not_found"
  end

  test "GET /projects/:id includes the persisted setup so the edit modal reflects it" do
    {:ok, _project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

    {:ok, _setup} =
      Context.upsert_project_setup("alpha", %{
        prompt_template: "Imported prompt",
        workflow_config: %{"tracker" => %{"active_states" => ["Todo"]}}
      })

    conn = get(authorized_conn(), "/api/tracker/v1/projects/alpha")

    assert %{"data" => %{"setup" => setup}} = json_response(conn, 200)
    refute is_nil(setup)
    assert setup["prompt_template"] == "Imported prompt"
    assert get_in(setup, ["workflow_config", "tracker", "active_states"]) == ["Todo"]
  end

  test "GET /projects/:id returns setup: nil when no setup exists" do
    {:ok, _project} = Context.ensure_project(%{name: "beta", slug: "beta", tracker_kind: "local"})

    conn = get(authorized_conn(), "/api/tracker/v1/projects/beta")

    assert %{"data" => %{"setup" => nil}} = json_response(conn, 200)
  end

  test "PUT then GET round-trips a fully structured workflow_config unchanged" do
    {:ok, _project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

    workflow_config = %{
      "tracker" => %{
        "active_states" => ["Todo", "In Progress"],
        "dispatch_states" => ["Todo"],
        "terminal_states" => ["Done"]
      },
      "agent" => %{
        "max_turns" => 25,
        "completion_transitions" => %{"In Review" => "Done"},
        "max_concurrent_agents_by_state" => %{"In Progress" => 2}
      },
      "hooks" => %{"after_create" => "echo hi"},
      "editor" => %{"enabled" => true, "port" => 8443, "auth" => "password"},
      "dev_server" => %{"enabled" => true, "auto_start_on" => ["pull_request"]},
      "public_tunnel" => %{"enabled" => true, "base_domain" => "preview.example.com"},
      "github" => %{"max_retries" => 5}
    }

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/alpha/setup", %{
        "setup" => %{"workflow_config" => workflow_config, "prompt_template" => "Hello"}
      })

    assert %{"data" => %{"setup" => setup}} = json_response(conn, 200)
    assert setup["workflow_config"]["tracker"]["active_states"] == ["Todo", "In Progress"]
    assert setup["workflow_config"]["agent"]["completion_transitions"] == %{"In Review" => "Done"}
    assert setup["workflow_config"]["agent"]["max_concurrent_agents_by_state"] == %{"In Progress" => 2}
    assert setup["workflow_config"]["hooks"]["after_create"] == "echo hi"
    assert setup["workflow_config"]["editor"]["auth"] == "password"
    assert setup["workflow_config"]["dev_server"]["auto_start_on"] == ["pull_request"]
    assert setup["workflow_config"]["public_tunnel"]["base_domain"] == "preview.example.com"
    assert setup["prompt_template"] == "Hello"

    show = get(authorized_conn(), "/api/tracker/v1/projects/alpha")
    assert %{"data" => %{"setup" => persisted}} = json_response(show, 200)
    assert persisted["workflow_config"] == workflow_config
    assert persisted["workflow_config"]["github"]["max_retries"] == 5
    assert persisted["prompt_template"] == "Hello"
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
