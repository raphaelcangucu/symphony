defmodule SymphonyElixirWeb.Tracker.WorkspaceSetupControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_tracker_token = System.get_env(@token_env)
    previous_github_token = System.get_env("GITHUB_TOKEN")
    previous_request_fun = Application.get_env(:symphony_elixir, :local_tracker_github_request_fun)

    System.put_env(@token_env, "secret")
    System.put_env("GITHUB_TOKEN", "test-token")

    on_exit(fn ->
      restore_env(@token_env, previous_tracker_token)
      restore_env("GITHUB_TOKEN", previous_github_token)
      Application.put_env(:symphony_elixir, :local_tracker_github_request_fun, previous_request_fun)
    end)

    :ok
  end

  test "lists github repositories for an owner" do
    Application.put_env(:symphony_elixir, :local_tracker_github_request_fun, fn _payload, _headers ->
      {:ok,
       %{
         status: 200,
         body: %{
           "data" => %{
             "repositoryOwner" => %{
               "repositories" => %{
                 "nodes" => [
                   %{
                     "name" => "front",
                     "nameWithOwner" => "clouapp/front",
                     "url" => "https://github.com/clouapp/front",
                     "sshUrl" => "git@github.com:clouapp/front.git",
                     "defaultBranchRef" => %{"name" => "homolog"},
                     "isPrivate" => true
                   }
                 ],
                 "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
               }
             }
           }
         }
       }}
    end)

    conn = get(authorized_conn(), "/api/tracker/v1/github/owners/clouapp/repositories")

    assert %{"data" => [%{"full_name" => "clouapp/front", "default_branch" => "homolog"}]} =
             json_response(conn, 200)
  end

  test "lists accessible github owners" do
    Application.put_env(:symphony_elixir, :local_tracker_github_request_fun, fn _payload, _headers ->
      {:ok,
       %{
         status: 200,
         body: %{
           "data" => %{
             "viewer" => %{
               "login" => "raphaelcangucu",
               "avatarUrl" => "https://github.com/raphaelcangucu.png",
               "organizations" => %{
                 "nodes" => [
                   %{"login" => "clouapp", "name" => "Clou App", "avatarUrl" => "https://github.com/clouapp.png"}
                 ],
                 "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
               }
             }
           }
         }
       }}
    end)

    conn = get(authorized_conn(), "/api/tracker/v1/github/owners")

    assert %{"data" => [%{"login" => "raphaelcangucu"}, %{"login" => "clouapp", "kind" => "organization"}]} =
             json_response(conn, 200)
  end

  test "scans repositories and suggests workspace setup" do
    root = Path.join(System.tmp_dir!(), "symphony-api-scan-test-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    File.write!(Path.join(root, "package.json"), ~s({"scripts":{"test":"vitest run"}}))
    on_exit(fn -> File.rm_rf(root) end)

    scan_conn =
      authorized_conn()
      |> post("/api/tracker/v1/project_setup/scan", %{
        "repositories" => [%{"local_path" => root, "workspace_path" => "frontend"}]
      })

    assert %{"data" => %{"scans" => [%{"workspace_path" => "frontend", "stack" => ["node"]}]}} =
             json_response(scan_conn, 200)

    suggest_conn =
      authorized_conn()
      |> post("/api/tracker/v1/project_setup/suggest", %{
        "repositories" => [
          %{
            "github_full_name" => "clouapp/front",
            "clone_url" => "https://github.com/clouapp/front.git",
            "selected_branch" => "homolog",
            "workspace_path" => "frontend",
            "role" => "frontend"
          }
        ],
        "scans" => [%{"workspace_path" => "frontend", "stack" => ["node"], "validation_commands" => ["npm test"]}]
      })

    assert %{
             "data" => %{
               "workflow_statuses" => [%{"name" => "Backlog"} | _],
               "after_create_hook" => hook,
               "validation_commands" => ["npm test"]
             }
           } = json_response(suggest_conn, 200)

    assert hook =~ "clouapp/front.git frontend"
  end

  test "creates workspace project with repositories and setup metadata" do
    conn =
      authorized_conn()
      |> post("/api/tracker/v1/projects/workspace", %{
        "name" => "Macro Markets",
        "slug" => "macro-markets",
        "workflow_statuses" => [
          %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false},
          %{"name" => "Done", "category" => "terminal", "position" => 1, "is_terminal" => true}
        ],
        "repositories" => [
          %{
            "github_full_name" => "clouapp/front",
            "clone_url" => "https://github.com/clouapp/front.git",
            "workspace_path" => "frontend",
            "role" => "frontend"
          }
        ],
        "setup" => %{
          "workflow_config" => %{"active_states" => ["Todo"], "terminal_states" => ["Done"]},
          "after_create_hook" => "git clone https://github.com/clouapp/front.git frontend",
          "prompt_template" => "Use frontend/.",
          "validation_commands" => ["npm test"],
          "scan_summary" => %{"repository_count" => 1}
        }
      })

    assert %{
             "data" => %{
               "slug" => "macro-markets",
               "repositories" => [%{"github_full_name" => "clouapp/front", "workspace_path" => "frontend"}],
               "setup" => %{"validation_commands" => ["npm test"]},
               "statuses" => [%{"name" => "Todo"}, %{"name" => "Done"}]
             }
           } = json_response(conn, 201)
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
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
