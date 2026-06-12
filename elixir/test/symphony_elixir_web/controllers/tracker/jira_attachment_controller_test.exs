defmodule SymphonyElixirWeb.Tracker.JiraAttachmentControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @jira_env %{
    "JIRA_BASE_URL" => "https://acme.atlassian.net",
    "JIRA_EMAIL" => "bot@acme.test",
    "JIRA_API_TOKEN" => "test-token"
  }

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()

    previous_token = System.get_env(@token_env)
    previous_request_fun = Application.get_env(:symphony_elixir, :jira_attachment_request_fun)
    previous_jira_env = Map.new(@jira_env, fn {key, _value} -> {key, System.get_env(key)} end)
    System.put_env(@token_env, "secret")
    System.put_env(@jira_env)

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_app_env(:jira_attachment_request_fun, previous_request_fun)
      Enum.each(previous_jira_env, fn {key, value} -> restore_env(key, value) end)
    end)

    {:ok, _jira} =
      Context.ensure_project(%{
        name: "Advising",
        slug: "advising",
        tracker_kind: "jira",
        tracker_config: %{"project_key" => "CDE"}
      })

    {:ok, _local} = Context.ensure_project(%{name: "Local Only", slug: "local-only"})

    :ok
  end

  test "streams attachment bytes with the JIRA content type" do
    Application.put_env(:symphony_elixir, :jira_attachment_request_fun, fn _url, _headers ->
      {:ok, %{status: 200, headers: [{"content-type", "image/png"}], body: <<137, 80, 78, 71>>}}
    end)

    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/advising/jira/attachments/10501")

    assert conn.status == 200
    assert [content_type] = get_resp_header(conn, "content-type")
    assert content_type =~ "image/png"
    assert conn.resp_body == <<137, 80, 78, 71>>
  end

  test "returns 404 for a non-JIRA project" do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/local-only/jira/attachments/10501")

    assert %{"error" => %{"code" => "issue_not_found"}} = json_response(conn, 404)
  end

  test "maps a remote 404 to issue_not_found" do
    Application.put_env(:symphony_elixir, :jira_attachment_request_fun, fn _url, _headers ->
      {:ok, %{status: 404, headers: [], body: ""}}
    end)

    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/advising/jira/attachments/does-not-exist")

    assert json_response(conn, 404)
  end

  test "rejects unauthenticated requests" do
    conn = get(build_conn(), "/api/tracker/v1/projects/advising/jira/attachments/10501")
    assert json_response(conn, 401)
  end

  defp migrate_repo do
    alias SymphonyElixir.Repo

    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp restore_env(key, value) do
    case value do
      nil -> System.delete_env(key)
      val -> System.put_env(key, val)
    end
  end

  defp restore_app_env(key, value) do
    case value do
      nil -> Application.delete_env(:symphony_elixir, key)
      val -> Application.put_env(:symphony_elixir, key, val)
    end
  end
end
