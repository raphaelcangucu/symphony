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

    markdown = "---\ntracker:\n  active_states: [Todo]\n---\n\nHello"

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/alpha/setup", %{
        "setup" => %{"workflow_markdown" => markdown}
      })

    assert %{"data" => %{"setup" => %{"workflow_markdown" => persisted}}} = json_response(conn, 200)
    assert persisted == markdown
  end

  test "PUT /projects/:id/setup rejects non-string workflow_markdown with 422 and does not persist" do
    {:ok, _project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/alpha/setup", %{
        "setup" => %{"workflow_markdown" => %{"not" => "a-string"}}
      })

    body = json_response(conn, 422)
    assert body["error"]["code"] == "validation_failed"
    assert body["error"]["message"] =~ "workflow_markdown must be a string"

    setup = Context.get_project_setup("alpha")
    assert is_nil(setup) or is_nil(setup.workflow_markdown)
  end

  test "PUT /projects/:id/setup rejects a malformed value inside workflow_markdown with 422" do
    {:ok, _project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/alpha/setup", %{
        "setup" => %{"workflow_markdown" => "---\ntracker:\n  active_states: 123\n---\n\nHello"}
      })

    body = json_response(conn, 422)
    assert body["error"]["code"] == "validation_failed"
    assert body["error"]["message"] =~ "tracker.active_states"

    setup = Context.get_project_setup("alpha")
    assert is_nil(setup) or is_nil(setup.workflow_markdown)
  end

  test "PUT /projects/:id/setup rejects forbidden process-owned sections with 422" do
    {:ok, _project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/alpha/setup", %{
        "setup" => %{"workflow_markdown" => "---\neditor:\n  enabled: true\n---\n\nHello"}
      })

    body = json_response(conn, 422)
    assert body["error"]["code"] == "validation_failed"
    assert body["error"]["message"] =~ "not allowed in per-project workflow"
  end

  test "PUT /projects/:id/setup returns 404 for unknown project" do
    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/nope/setup", %{
        "setup" => %{"workflow_markdown" => "Hello"}
      })

    assert json_response(conn, 404)["error"]["code"] == "project_not_found"
  end

  test "GET /projects/:id includes the persisted setup so the edit modal reflects it" do
    {:ok, _project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

    markdown = "---\ntracker:\n  active_states: [Todo]\n---\n\nImported prompt"

    {:ok, _setup} = Context.upsert_project_setup("alpha", %{workflow_markdown: markdown})

    conn = get(authorized_conn(), "/api/tracker/v1/projects/alpha")

    assert %{"data" => %{"setup" => setup}} = json_response(conn, 200)
    refute is_nil(setup)
    assert setup["workflow_markdown"] == markdown
  end

  test "GET /projects/:id returns setup: nil when no setup exists" do
    {:ok, _project} = Context.ensure_project(%{name: "beta", slug: "beta", tracker_kind: "local"})

    conn = get(authorized_conn(), "/api/tracker/v1/projects/beta")

    assert %{"data" => %{"setup" => nil}} = json_response(conn, 200)
  end

  test "PUT then GET round-trips fully structured workflow_markdown unchanged" do
    {:ok, _project} = Context.ensure_project(%{name: "alpha", slug: "alpha", tracker_kind: "local"})

    markdown = """
    ---
    tracker:
      active_states: [Todo, In Progress]
      dispatch_states: [Todo]
      terminal_states: [Done]
    agent:
      max_turns: 25
      completion_transitions:
        In Review: Done
      max_concurrent_agents_by_state:
        In Progress: 2
    hooks:
      after_create: echo hi
    ---

    Hello
    """

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/alpha/setup", %{
        "setup" => %{"workflow_markdown" => markdown}
      })

    assert %{"data" => %{"setup" => setup}} = json_response(conn, 200)
    assert setup["workflow_markdown"] == markdown

    show = get(authorized_conn(), "/api/tracker/v1/projects/alpha")
    assert %{"data" => %{"setup" => persisted}} = json_response(show, 200)
    assert persisted["workflow_markdown"] == markdown
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
