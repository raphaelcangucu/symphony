defmodule SymphonyElixirWeb.Tracker.LoadContextSourceControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.GitHub.ReadCache
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.SavedContexts.Entry

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule FakeGitHubClient do
    @moduledoc false

    def rest_get("/search/issues?" <> _query, _opts) do
      {:ok,
       %{
         body: %{
           "items" => [
             %{
               "number" => 42,
               "title" => "GitHub context",
               "html_url" => "https://github.com/o/r/issues/42",
               "state" => "open",
               "updated_at" => "2026-07-03T12:00:00Z",
               "user" => %{"login" => "octocat"}
             }
           ]
         }
       }}
    end

    def rest_get("/repos/o/r/dependabot/alerts?" <> _query, _opts), do: {:ok, %{body: []}}

    def rest_get("/repos/o/r/security-advisories?" <> _query, _opts) do
      {:ok,
       %{
         body: [
           %{
             "ghsa_id" => "GHSA-abcd-1234",
             "summary" => "Repository advisory",
             "severity" => "high",
             "state" => "published"
           }
         ]
       }}
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()
    ReadCache.invalidate_all()
    Application.put_env(:symphony_elixir, :github_client_module, FakeGitHubClient)

    previous_token = System.get_env(@token_env)
    previous_github_token = System.get_env(@github_token_env)
    System.put_env(@token_env, "secret")
    System.put_env(@github_token_env, "gh-token")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_env(@github_token_env, previous_github_token)
      Application.delete_env(:symphony_elixir, :github_client_module)
    end)

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Macro Markets",
        "slug" => "macro-markets",
        "tracker" => %{"kind" => "local"},
        "repositories" => [
          %{
            "github_full_name" => "o/r",
            "clone_url" => "https://github.com/o/r.git",
            "role" => "primary",
            "workspace_path" => "r"
          }
        ],
        "setup" => %{}
      })

    :ok
  end

  test "lists saved contexts for a project" do
    {:ok, _entry} =
      %Entry{}
      |> Entry.changeset(%{project_slug: "macro-markets", slug: "recap", name: "Recap", content_md: "# Recap"})
      |> Repo.insert()

    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/saved-contexts")

    assert %{"data" => [%{"slug" => "recap", "name" => "Recap"}]} = json_response(conn, 200)
  end

  test "lists GitHub issues for load context" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/github-issues")

    assert %{"supported" => true, "data" => [%{"number" => 42, "repo" => "o/r"}]} = json_response(conn, 200)
  end

  test "lists security advisories for load context" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/macro-markets/security-advisories")

    assert %{
             "supported" => true,
             "dependabot" => [],
             "advisories" => [%{"ghsa_id" => "GHSA-abcd-1234", "repo" => "o/r"}]
           } = json_response(conn, 200)
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    Repo.delete_all(Entry)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
