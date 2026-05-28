defmodule SymphonyElixirWeb.Tracker.TerminalControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  defmodule FakeTmux do
    def available?, do: true
    def has_session?("sym-issue-macro-markets-MAC-1"), do: false
    def new_session("sym-issue-macro-markets-MAC-1", _cwd), do: :ok
    def capture_pane("sym-issue-macro-markets-MAC-1"), do: {:ok, "terminal ready\n"}
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    previous_tmux = Application.get_env(:symphony_elixir, :terminal_tmux)
    System.put_env(@token_env, "secret")
    Application.put_env(:symphony_elixir, :terminal_tmux, FakeTmux)

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_application_env(:terminal_tmux, previous_tmux)
    end)

    :ok
  end

  test "opens a terminal session for a project issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _issue} = Context.create_issue("macro-markets", %{"title" => "Terminal issue", "status" => "Todo"})

    conn = post(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-1/terminal")

    assert %{
             "data" => %{
               "issue_identifier" => "MAC-1",
               "project_slug" => "macro-markets",
               "session_name" => "sym-issue-macro-markets-MAC-1",
               "state" => "running",
               "channel_topic" => "terminal:macro-markets:MAC-1",
               "cwd" => cwd
             }
           } = json_response(conn, 200)

    assert String.ends_with?(cwd, "/macro-markets-MAC-1")
  end

  test "returns issue not found for missing terminal issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    conn = post(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/MAC-404/terminal")

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "issue_not_found", "message" => "Issue not found"}
           }
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

  defp restore_application_env(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore_application_env(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
