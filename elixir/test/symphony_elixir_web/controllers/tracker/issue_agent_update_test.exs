defmodule SymphonyElixirWeb.Tracker.IssueAgentUpdateTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous = System.get_env(@token_env)
    System.put_env(@token_env, "test-token")
    on_exit(fn -> if previous, do: System.put_env(@token_env, previous), else: System.delete_env(@token_env) end)

    {:ok, _project} = Context.ensure_project(%{name: "Pref", slug: "pref"})
    {:ok, issue} = Context.create_issue("pref", %{"title" => "Switchable", "status" => "Todo"})
    {:ok, issue: issue}
  end

  defp authed_conn, do: build_conn() |> put_req_header("authorization", "Bearer test-token")

  test "PUT issues/:identifier with agent writes the symphony:<kind> label", %{issue: issue} do
    conn = put(authed_conn(), "/api/tracker/v1/projects/pref/issues/#{issue.identifier}", %{"agent" => "claude"})

    assert %{"data" => _} = json_response(conn, 200)

    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    assert "symphony:claude" in label_names(updated)

    conn2 = put(authed_conn(), "/api/tracker/v1/projects/pref/issues/#{issue.identifier}", %{"agent" => "codex"})
    assert json_response(conn2, 200)

    {:ok, updated2} = Context.get_issue("pref", issue.identifier)
    assert "symphony:codex" in label_names(updated2)
    refute "symphony:claude" in label_names(updated2)
  end

  test "agent: nil clears the routing label back to inherit", %{issue: issue} do
    put(authed_conn(), "/api/tracker/v1/projects/pref/issues/#{issue.identifier}", %{"agent" => "claude"})
    conn = put(authed_conn(), "/api/tracker/v1/projects/pref/issues/#{issue.identifier}", %{"agent" => nil})

    assert json_response(conn, 200)
    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    refute Enum.any?(label_names(updated), &String.starts_with?(&1, "symphony:"))
  end

  test "PUT without agent key does not touch existing routing labels", %{issue: issue} do
    put(authed_conn(), "/api/tracker/v1/projects/pref/issues/#{issue.identifier}", %{"agent" => "claude"})

    # Now update title only — no agent key
    conn = put(authed_conn(), "/api/tracker/v1/projects/pref/issues/#{issue.identifier}", %{"title" => "Changed"})

    assert json_response(conn, 200)
    {:ok, updated} = Context.get_issue("pref", issue.identifier)
    # The symphony:claude label should remain untouched
    assert "symphony:claude" in label_names(updated)
  end

  defp label_names(issue) do
    issue |> Map.get(:labels) |> Enum.map(& &1.name)
  end

  defp migrate_repo do
    path = Application.app_dir(:symphony_elixir, "priv/repo/migrations")
    Ecto.Migrator.run(SymphonyElixir.Repo, path, :up, all: true, log: false)
  end

  defp clean_repo do
    SymphonyElixir.Repo.delete_all(SymphonyElixir.LocalTracker.IssueLabel)
    SymphonyElixir.Repo.delete_all(SymphonyElixir.LocalTracker.IssueRecord)
    SymphonyElixir.Repo.delete_all(SymphonyElixir.LocalTracker.Label)
    SymphonyElixir.Repo.delete_all(SymphonyElixir.LocalTracker.Project)
  end
end
