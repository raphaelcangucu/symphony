defmodule SymphonyElixirWeb.Tracker.TemplateControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.{Context, Templates}
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

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  test "create, list, show, delete templates" do
    create =
      post(authorized_conn(), "/api/tracker/v1/templates", %{
        "name" => "Gamba",
        "slug" => "gamba",
        "validation_commands" => ["mix test"],
        "repositories" => [%{"github_full_name" => "g/api", "clone_url" => "u", "workspace_path" => "api", "role" => "backend"}]
      })

    assert %{"data" => %{"slug" => "gamba"}} = json_response(create, 201)

    list = get(authorized_conn(), "/api/tracker/v1/templates")
    assert %{"data" => [%{"slug" => "gamba"}]} = json_response(list, 200)

    show = get(authorized_conn(), "/api/tracker/v1/templates/gamba")
    assert %{"data" => %{"validation_commands" => ["mix test"]}} = json_response(show, 200)

    del = delete(authorized_conn(), "/api/tracker/v1/templates/gamba")
    assert response(del, 204)
  end

  test "show returns 404 for unknown slug" do
    conn = get(authorized_conn(), "/api/tracker/v1/templates/nope")
    assert json_response(conn, 404)["error"]["code"] == "template_not_found"
  end

  test "create returns validation error for missing slug" do
    conn = post(authorized_conn(), "/api/tracker/v1/templates", %{"name" => "NoSlug"})
    assert json_response(conn, 422)["error"]["code"] == "validation_failed"
  end

  test "update modifies an existing template" do
    {:ok, _template} = Templates.create_template(%{"name" => "Gamba", "slug" => "gamba"})

    conn =
      put(authorized_conn(), "/api/tracker/v1/templates/gamba", %{"description" => "Updated description"})

    assert %{"data" => %{"description" => "Updated description"}} = json_response(conn, 200)
  end

  test "update returns 404 for unknown slug" do
    conn = put(authorized_conn(), "/api/tracker/v1/templates/nope", %{"description" => "x"})
    assert json_response(conn, 404)["error"]["code"] == "template_not_found"
  end

  test "delete returns 404 for unknown slug" do
    conn = delete(authorized_conn(), "/api/tracker/v1/templates/nope")
    assert json_response(conn, 404)["error"]["code"] == "template_not_found"
  end

  test "import creates a template from valid YAML" do
    conn =
      post(authorized_conn(), "/api/tracker/v1/templates/import", %{
        "yaml" => "name: \"Imported\"\nslug: \"imported\"\n"
      })

    assert %{"data" => %{"slug" => "imported"}} = json_response(conn, 201)
  end

  test "import returns validation error for invalid YAML" do
    conn = post(authorized_conn(), "/api/tracker/v1/templates/import", %{"yaml" => "- not\n- a\n- map\n"})
    assert json_response(conn, 422)["error"]["code"] == "validation_failed"
  end

  test "import returns changeset error for YAML missing required fields" do
    {:ok, _template} = Templates.create_template(%{"name" => "Dup", "slug" => "dup"})

    conn =
      post(authorized_conn(), "/api/tracker/v1/templates/import", %{
        "yaml" => "name: \"Dup Again\"\nslug: \"dup\"\n"
      })

    assert json_response(conn, 422)["error"]["code"] == "validation_failed"
  end

  test "export returns YAML body" do
    {:ok, _template} = Templates.create_template(%{"name" => "Gamba", "slug" => "gamba"})

    conn = get(authorized_conn(), "/api/tracker/v1/templates/gamba/export")

    assert response(conn, 200) =~ "gamba"
    assert {"content-type", "text/yaml; charset=utf-8"} = List.keyfind(conn.resp_headers, "content-type", 0)
  end

  test "export returns 404 for unknown slug" do
    conn = get(authorized_conn(), "/api/tracker/v1/templates/nope/export")
    assert json_response(conn, 404)["error"]["code"] == "template_not_found"
  end

  test "instantiate creates a project from a template with no repositories" do
    {:ok, _template} =
      Templates.create_template(%{
        "name" => "Empty",
        "slug" => "empty-tpl",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => []
      })

    conn =
      post(authorized_conn(), "/api/tracker/v1/templates/empty-tpl/instantiate", %{
        "name" => "Empty One",
        "slug" => "empty-one"
      })

    assert %{"data" => %{"slug" => "empty-one", "id" => _id}} = json_response(conn, 201)
    assert Templates.list_clone_jobs("empty-one") == []
  end

  test "instantiate returns 404 for unknown template" do
    conn =
      post(authorized_conn(), "/api/tracker/v1/templates/nope/instantiate", %{"name" => "X", "slug" => "x"})

    assert json_response(conn, 404)["error"]["code"] == "template_not_found"
  end

  test "save_as_template captures an existing project" do
    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Source",
        "slug" => "source",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [],
        "setup" => %{}
      })

    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/source/save_as_template", %{
        "name" => "Source Template",
        "slug" => "source-tpl"
      })

    assert %{"data" => %{"slug" => "source-tpl"}} = json_response(conn, 201)
  end

  test "save_as_template returns 404 for unknown project" do
    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/nope/save_as_template", %{"slug" => "x"})

    assert json_response(conn, 404)["error"]["code"] == "project_not_found"
  end

  test "clone_jobs index lists pending jobs for a project" do
    {:ok, _template} =
      Templates.create_template(%{
        "name" => "Cloner",
        "slug" => "cloner",
        "repositories" => [
          %{"github_full_name" => "g/api", "clone_url" => "https://github.com/g/api.git", "workspace_path" => "{{slug}}/api", "role" => "backend"}
        ]
      })

    {:ok, _project} = Templates.instantiate_template("cloner", %{"name" => "Cloner One", "slug" => "cloner-one"})

    conn = get(authorized_conn(), "/api/tracker/v1/projects/cloner-one/clone_jobs")

    assert %{"data" => [%{"status" => "pending"}]} = json_response(conn, 200)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_clone_jobs",
          "local_tracker_workspace_template_repositories",
          "local_tracker_workspace_templates",
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_repositories",
          "local_tracker_project_setups",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
