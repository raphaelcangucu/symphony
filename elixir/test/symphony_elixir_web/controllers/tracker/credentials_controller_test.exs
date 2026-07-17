defmodule SymphonyElixirWeb.Tracker.CredentialsControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Credentials
  alias SymphonyElixir.Settings.Setting

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    Repo.delete_all(Setting)
    previous = System.get_env(@token_env)
    System.put_env(@token_env, "test-token")

    on_exit(fn ->
      Repo.delete_all(Setting)
      if previous, do: System.put_env(@token_env, previous), else: System.delete_env(@token_env)
    end)

    :ok
  end

  defp authed_conn do
    build_conn() |> put_req_header("authorization", "Bearer test-token")
  end

  test "GET lists providers and never returns secret values in clear text" do
    conn = get(authed_conn(), "/api/tracker/v1/settings/credentials")
    assert %{"data" => %{"providers" => providers}} = json_response(conn, 200)

    names = providers |> Enum.map(& &1["provider"]) |> Enum.sort()
    assert names == Credentials.providers() |> Enum.sort()

    github = Enum.find(providers, &(&1["provider"] == "github"))
    token_field = Enum.find(github["fields"], &(&1["key"] == "token"))
    assert token_field["secret"] == true
    refute Map.has_key?(token_field, "value")
  end

  test "PUT stores a secret and reports it as a masked, db-sourced hint" do
    conn =
      put(authed_conn(), "/api/tracker/v1/settings/credentials", %{
        "provider" => "github",
        "key" => "token",
        "value" => "ghp_supersecret9999"
      })

    assert %{"data" => %{"provider" => "github", "fields" => fields}} = json_response(conn, 200)
    token_field = Enum.find(fields, &(&1["key"] == "token"))

    assert token_field["configured"] == true
    assert token_field["source"] == "db"
    assert token_field["hint"] == "••••9999"
    refute Map.has_key?(token_field, "value")
  end

  test "PUT with a blank value clears the override" do
    put(authed_conn(), "/api/tracker/v1/settings/credentials", %{
      "provider" => "linear",
      "key" => "api_key",
      "value" => "lin_secret"
    })

    conn =
      put(authed_conn(), "/api/tracker/v1/settings/credentials", %{
        "provider" => "linear",
        "key" => "api_key",
        "value" => ""
      })

    assert %{"data" => %{"fields" => fields}} = json_response(conn, 200)
    api_key = Enum.find(fields, &(&1["key"] == "api_key"))
    assert api_key["source"] in ["env", "none"]
  end

  test "non-secret jira fields are returned in clear text for editing" do
    conn =
      put(authed_conn(), "/api/tracker/v1/settings/credentials", %{
        "provider" => "jira",
        "key" => "base_url",
        "value" => "https://acme.atlassian.net"
      })

    assert %{"data" => %{"fields" => fields}} = json_response(conn, 200)
    base_url = Enum.find(fields, &(&1["key"] == "base_url"))
    assert base_url["secret"] == false
    assert base_url["value"] == "https://acme.atlassian.net"
  end

  test "DELETE clears a stored credential" do
    put(authed_conn(), "/api/tracker/v1/settings/credentials", %{
      "provider" => "github",
      "key" => "token",
      "value" => "ghp_xyz"
    })

    conn = delete(authed_conn(), "/api/tracker/v1/settings/credentials/github/token")
    assert %{"data" => %{"fields" => fields}} = json_response(conn, 200)
    token_field = Enum.find(fields, &(&1["key"] == "token"))
    assert token_field["source"] in ["env", "none"]
  end

  test "rejects unknown provider/field with 404" do
    conn =
      put(authed_conn(), "/api/tracker/v1/settings/credentials", %{
        "provider" => "slack",
        "key" => "token",
        "value" => "x"
      })

    assert %{"error" => %{"code" => "unknown_credential"}} = json_response(conn, 404)
  end

  test "requests without the bearer token are unauthorized" do
    conn = get(build_conn(), "/api/tracker/v1/settings/credentials")
    assert json_response(conn, 401)
  end
end
