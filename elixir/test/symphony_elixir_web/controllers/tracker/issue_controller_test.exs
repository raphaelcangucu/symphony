defmodule SymphonyElixirWeb.Tracker.IssueControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.{Context, Viewer}
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
    end)

    :ok
  end

  test "rejects missing tracker bearer token" do
    conn = get(build_conn(), "/api/tracker/v1/projects")

    assert json_response(conn, 401) == %{
             "error" => %{"code" => "unauthorized", "message" => "invalid tracker token"}
           }
  end

  test "creates and reads projects with bearer token" do
    conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects", %{
        "name" => "Macro Markets",
        "slug" => "macro-markets",
        "description" => "Local tracker project"
      })

    assert %{
             "data" => %{
               "name" => "Macro Markets",
               "slug" => "macro-markets",
               "description" => "Local tracker project",
               "statuses" => statuses
             }
           } = json_response(conn, 201)

    assert Enum.map(statuses, & &1["name"]) == [
             "Backlog",
             "Todo",
             "In Progress",
             "Human Review",
             "Merging",
             "Rework",
             "Done"
           ]

    list_conn = get(authorized_conn(), "/api/tracker/v1/projects")
    assert %{"data" => [%{"slug" => "macro-markets"}]} = json_response(list_conn, 200)

    show_conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets")
    assert %{"data" => %{"slug" => "macro-markets"}} = json_response(show_conn, 200)
  end

  test "manages project issues, comments, and blockers" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    create_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/issues", %{
        "title" => "API issue",
        "description" => "Created through JSON API",
        "status" => "Todo",
        "priority" => 1
      })

    assert %{"data" => %{"identifier" => "MAC-1", "title" => "API issue", "status" => %{"name" => "Todo"}}} =
             json_response(create_conn, 201)

    {:ok, _blocker} = Context.create_issue("macro-markets", %{"title" => "Blocking issue", "status" => "Todo"})

    list_conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues")
    assert %{"data" => [%{"identifier" => "MAC-1"}, %{"identifier" => "MAC-2"}]} = json_response(list_conn, 200)

    update_conn =
      authorized_conn()
      |> patch("/api/tracker/v1/projects/macro-markets/issues/MAC-1", %{
        "description" => "Updated through API"
      })

    assert %{"data" => %{"description" => "Updated through API"}} = json_response(update_conn, 200)

    move_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/issues/MAC-1/move", %{"status" => "In Progress"})

    assert %{"data" => %{"status" => %{"name" => "In Progress"}}} = json_response(move_conn, 200)

    comment_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/issues/MAC-1/comments", %{
        "body" => "Needs review",
        "author" => "api"
      })

    assert %{"data" => %{"body" => "Needs review", "author" => "api"}} = json_response(comment_conn, 201)

    list_comments_conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/comments")

    assert %{"data" => [%{"body" => "Needs review", "author" => "api"}]} =
             json_response(list_comments_conn, 200)

    blocker_conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/macro-markets/issues/MAC-1/blockers", %{
        "target_identifier" => "MAC-2"
      })

    assert %{"data" => %{"source_identifier" => "MAC-1", "target_identifier" => "MAC-2"}} =
             json_response(blocker_conn, 201)

    list_blockers_conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/blockers")

    assert %{"data" => [%{"source_identifier" => "MAC-1", "target_identifier" => "MAC-2"}]} =
             json_response(list_blockers_conn, 200)

    delete_conn =
      authorized_conn()
      |> delete("/api/tracker/v1/projects/macro-markets/issues/MAC-1/blockers/MAC-2")

    assert response(delete_conn, 204) == ""
  end

  test "returns clear errors for missing tracker records" do
    conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/missing/issues", %{"title" => "No project"})

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "project_not_found", "message" => "Project not found"}
           }
  end

  describe "index filters" do
    setup do
      unless Process.whereis(Viewer.Server) do
        {:ok, _pid} = start_supervised(Viewer.Server)
      end

      Viewer.invalidate_cache()

      {:ok, _project} = Context.ensure_project(%{name: "F", slug: "filtered"})

      {:ok, _} =
        Context.create_issue("filtered", %{
          title: "ABC",
          status: "Todo",
          assignee_id: "alice",
          creator: "alice"
        })

      {:ok, _} =
        Context.create_issue("filtered", %{
          title: "XYZ",
          status: "Todo",
          assignee_id: "bob",
          creator: "bob"
        })

      :ok
    end

    test "filters by assignee query param" do
      conn = get(authorized_conn(), "/api/tracker/v1/projects/filtered/issues?assignee=alice")

      assert %{"data" => [%{"title" => "ABC"}]} = json_response(conn, 200)
    end

    test "filters by creator query param" do
      conn = get(authorized_conn(), "/api/tracker/v1/projects/filtered/issues?creator=bob")

      assert %{"data" => [%{"title" => "XYZ"}]} = json_response(conn, 200)
    end

    test "filters by q (keyword)" do
      conn = get(authorized_conn(), "/api/tracker/v1/projects/filtered/issues?q=ABC")

      assert %{"data" => [%{"title" => "ABC"}]} = json_response(conn, 200)
    end

    test "resolves assignee=me to the viewer login" do
      Viewer.put_cached(%{login: "alice", name: "Alice", avatar_url: nil})

      conn = get(authorized_conn(), "/api/tracker/v1/projects/filtered/issues?assignee=me")

      assert %{"data" => [%{"title" => "ABC"}]} = json_response(conn, 200)
    end

    test "returns 503 when assignee=me but viewer unavailable" do
      System.delete_env("GITHUB_TOKEN")
      Viewer.invalidate_cache()

      conn = get(authorized_conn(), "/api/tracker/v1/projects/filtered/issues?assignee=me")

      assert %{"error" => %{"code" => "github_token_missing"}} = json_response(conn, 503)
    end
  end

  describe "create issue with viewer creator" do
    setup do
      unless Process.whereis(Viewer.Server) do
        {:ok, _pid} = start_supervised(Viewer.Server)
      end

      Viewer.invalidate_cache()
      {:ok, _project} = Context.ensure_project(%{name: "C", slug: "creator-route"})
      :ok
    end

    test "fills creator from cached viewer login" do
      Viewer.put_cached(%{login: "octocat", name: nil, avatar_url: nil})

      conn =
        authorized_conn()
        |> post("/api/tracker/v1/projects/creator-route/issues", %{
          "title" => "From API",
          "status" => "Todo"
        })

      assert %{"data" => %{"creator" => "octocat"}} = json_response(conn, 201)
    end

    test "still creates issue (creator nil) when viewer unavailable" do
      System.delete_env("GITHUB_TOKEN")
      Viewer.invalidate_cache()

      conn =
        authorized_conn()
        |> post("/api/tracker/v1/projects/creator-route/issues", %{
          "title" => "From API no viewer",
          "status" => "Todo"
        })

      assert %{"data" => %{"creator" => nil}} = json_response(conn, 201)
    end
  end

  defmodule FakeRemoteAdapter do
    @behaviour SymphonyElixir.Tracker.IssueAdapter
    alias SymphonyElixir.Tracker.IssueDTO

    def kind, do: :github

    def list_issues(_project, _filters),
      do:
        {:ok,
         [
           IssueDTO.build(%{
             identifier: "#1",
             title: "Remote",
             status: %{name: "Todo", category: "unstarted", position: 0, is_terminal: false},
             project_slug: "remote"
           })
         ]}

    def get_issue(_p, _i), do: {:error, :issue_not_found}
    def create_issue(_p, _a), do: {:error, :not_supported_on_remote}
    def update_issue(_p, _i, _a), do: {:error, :not_supported_on_remote}
    def move_issue(_p, _i, _a), do: {:error, :not_supported_on_remote}

    def list_statuses(_p),
      do: {:ok, [%{name: "Todo", category: "unstarted", position: 0, is_terminal: false}]}

    def list_labels(_p),
      do: {:ok, [%{id: "L1", name: "bug", color: "ff0000"}, %{id: "L2", name: "symphony:codex", color: nil}]}

    def list_assignable_users(_p),
      do: {:ok, [%{id: "U1", login: "alice", name: "Alice", avatar_url: "https://example.test/a.png"}]}

    def list_comments(_p, _i), do: {:error, :not_supported_on_remote}
    def add_comment(_p, _i, _b, _a), do: {:error, :not_supported_on_remote}
  end

  defmodule FakeCreatingAdapter do
    @behaviour SymphonyElixir.Tracker.IssueAdapter
    alias SymphonyElixir.Tracker.IssueDTO

    def kind, do: :github

    def list_issues(_p, _f), do: {:ok, []}
    def get_issue(_p, _i), do: {:error, :issue_not_found}

    def create_issue(_p, attrs) do
      {:ok,
       IssueDTO.build(%{
         identifier: "#42",
         title: Map.get(attrs, "title"),
         labels: Map.get(attrs, "label_ids", []),
         status: %{
           name: Map.get(attrs, "status"),
           category: "unstarted",
           position: 0,
           is_terminal: false
         },
         project_slug: "remote-create"
       })}
    end

    def update_issue(_p, _i, _a), do: {:error, :not_supported_on_remote}
    def move_issue(_p, _i, _a), do: {:error, :not_supported_on_remote}
    def list_statuses(_p), do: {:ok, []}
    def list_labels(_p), do: {:ok, []}
    def list_assignable_users(_p), do: {:ok, []}
    def list_comments(_p, _i), do: {:error, :not_supported_on_remote}
    def add_comment(_p, _i, _b, _a), do: {:error, :not_supported_on_remote}
  end

  describe "remote project dispatch" do
    setup do
      Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => FakeRemoteAdapter})

      {:ok, project} =
        Context.create_workspace_project(%{
          "name" => "Remote",
          "slug" => "remote",
          "tracker" => %{"kind" => "github", "config" => %{"repo" => "o/r", "project_id" => "PVT_1"}},
          "repositories" => [],
          "setup" => %{}
        })

      on_exit(fn -> Application.delete_env(:symphony_elixir, :issue_adapters) end)

      %{project: project}
    end

    test "index dispatches to the remote adapter" do
      conn = get(authorized_conn(), "/api/tracker/v1/projects/remote/issues")
      assert %{"data" => [%{"identifier" => "#1", "title" => "Remote"}]} = json_response(conn, 200)
    end

    test "create returns 501 for unsupported remote mutation" do
      conn =
        post(authorized_conn(), "/api/tracker/v1/projects/remote/issues", %{
          "title" => "x",
          "status" => "Todo"
        })

      assert json_response(conn, 501)["error"]["code"] == "tracker_not_supported"
    end

    test "form_options returns labels, assignees, statuses, and agents" do
      conn = get(authorized_conn(), "/api/tracker/v1/projects/remote/issues/form_options")

      assert %{
               "data" => %{
                 "labels" => labels,
                 "assignees" => assignees,
                 "statuses" => statuses,
                 "agents" => agents
               }
             } = json_response(conn, 200)

      assert Enum.any?(labels, &(&1["name"] == "bug"))
      assert [%{"login" => "alice", "id" => "U1"}] = assignees
      assert Enum.any?(statuses, &(&1["name"] == "Todo"))
      assert is_list(agents)
    end
  end

  describe "remote create dispatch" do
    setup do
      Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => FakeCreatingAdapter})

      {:ok, project} =
        Context.create_workspace_project(%{
          "name" => "Remote Create",
          "slug" => "remote-create",
          "tracker" => %{"kind" => "github", "config" => %{"repo" => "o/r", "project_id" => "PVT_2"}},
          "repositories" => [],
          "setup" => %{}
        })

      on_exit(fn -> Application.delete_env(:symphony_elixir, :issue_adapters) end)

      %{project: project}
    end

    test "create passes labels/assignees/agent through and returns the created issue" do
      conn =
        post(authorized_conn(), "/api/tracker/v1/projects/remote-create/issues", %{
          "title" => "Social login first",
          "status" => "Todo",
          "label_ids" => ["L1"],
          "assignee_ids" => ["U1"],
          "agent" => "codex"
        })

      assert %{
               "data" => %{
                 "identifier" => "#42",
                 "title" => "Social login first",
                 "labels" => ["L1"]
               }
             } = json_response(conn, 201)
    end
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
