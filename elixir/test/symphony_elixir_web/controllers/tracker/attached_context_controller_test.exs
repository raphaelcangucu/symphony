defmodule SymphonyElixirWeb.Tracker.AttachedContextControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.AttachedContexts.Attachment
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.SavedContexts.Entry

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    on_exit(fn -> restore_env(@token_env, previous_token) end)

    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, target_issue} = Context.create_issue("macro-markets", %{title: "Target", status: "Todo"})
    {:ok, context_issue} = Context.create_issue("macro-markets", %{title: "Context", status: "Todo"})

    %{target_issue: target_issue, context_issue: context_issue}
  end

  test "creates, lists, and deletes execution attached contexts", %{target_issue: target, context_issue: context} do
    base = "/api/tracker/v1/projects/macro-markets/issues/#{target.identifier}/contexts"

    assert %{"data" => []} = json_response(get(authorized_conn(), base), 200)

    create_conn =
      post(authorized_conn(), base, %{
        "kind" => "board_issue",
        "ref_key" => context.identifier
      })

    assert %{"data" => created} = json_response(create_conn, 201)
    assert created["kind"] == "board_issue"
    assert created["ref_key"] == context.identifier
    assert created["title"] =~ context.identifier
    assert created["content_md"] =~ "### Board issue #{context.identifier}"

    assert %{"data" => [listed]} = json_response(get(authorized_conn(), base), 200)
    assert listed["id"] == created["id"]

    delete_conn = delete(authorized_conn(), "#{base}/#{created["id"]}")
    assert response(delete_conn, 204) == ""

    assert %{"data" => []} = json_response(get(authorized_conn(), base), 200)
  end

  test "returns validation error for invalid attach payload", %{target_issue: target} do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/macro-markets/issues/#{target.identifier}/contexts", %{})

    assert %{"error" => %{"code" => "invalid_context_params"}} = json_response(conn, 422)
  end

  test "creates and lists assistant attached contexts", %{context_issue: context} do
    {:ok, thread} = History.ensure_thread("macro-markets", %{workspace_path: "/tmp/assistant/macro-markets"})
    base = "/api/tracker/v1/assistant/threads/#{thread.id}/contexts"

    conn =
      post(authorized_conn(), base, %{
        "project_slug" => "macro-markets",
        "kind" => "board_issue",
        "ref_key" => context.identifier
      })

    assert %{"data" => created} = json_response(conn, 201)
    assert created["scope"] == "assistant"
    assert created["thread_id"] == thread.id

    assert %{"data" => [listed]} = json_response(get(authorized_conn(), base), 200)
    assert listed["id"] == created["id"]
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
    Repo.delete_all(Attachment)
    Repo.delete_all(Entry)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
