defmodule SymphonyElixir.GitHub.ClientRestTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.Client

  setup do
    System.put_env("GITHUB_TOKEN", "test-token")
    on_exit(fn -> System.delete_env("GITHUB_TOKEN") end)
    :ok
  end

  test "rest_get builds url + headers and returns body" do
    request_fun = fn url, headers ->
      assert url == "https://api.github.com/repos/acme/app/actions/jobs/9/logs"
      assert {"Authorization", "Bearer test-token"} in headers
      assert {"X-GitHub-Api-Version", "2022-11-28"} in headers
      {:ok, %{status: 200, body: "line1\nline2"}}
    end

    assert {:ok, %{status: 200, body: "line1\nline2"}} =
             Client.rest_get("/repos/acme/app/actions/jobs/9/logs", request_fun: request_fun)
  end

  test "rest_get maps non-2xx status to error" do
    request_fun = fn _url, _headers -> {:ok, %{status: 404, body: ""}} end

    assert {:error, {:github_api_status, 404}} =
             Client.rest_get("/repos/acme/app/actions/jobs/9/logs", request_fun: request_fun)
  end

  test "rest_get returns missing token error when unset" do
    System.delete_env("GITHUB_TOKEN")

    assert {:error, :missing_github_token} =
             Client.rest_get("/repos/acme/app/actions/jobs/9/logs",
               request_fun: fn _u, _h -> {:ok, %{status: 200, body: ""}} end
             )
  end

  test "rest_put sends a PUT with auth headers + JSON body, returns 202 ok" do
    request_fun = fn url, headers, body ->
      send(self(), {:put, url, headers, body})
      {:ok, %{status: 202, body: %{}}}
    end

    assert {:ok, %{status: 202}} =
             Client.rest_put("/repos/acme/app/pulls/9/update-branch", %{}, request_fun: request_fun)

    assert_received {:put, "https://api.github.com/repos/acme/app/pulls/9/update-branch", headers, %{}}
    assert {"Authorization", "Bearer test-token"} in headers
    assert {"X-GitHub-Api-Version", "2022-11-28"} in headers
  end

  test "rest_put maps a 422 to a github_api_status error" do
    request_fun = fn _url, _headers, _body -> {:ok, %{status: 422, body: %{}}} end

    assert {:error, {:github_api_status, 422}} =
             Client.rest_put("/repos/acme/app/pulls/9/update-branch", %{}, request_fun: request_fun)
  end

  test "rest_put returns missing token error when unset" do
    System.delete_env("GITHUB_TOKEN")

    assert {:error, :missing_github_token} =
             Client.rest_put("/repos/acme/app/pulls/9/update-branch", %{}, request_fun: fn _u, _h, _b -> {:ok, %{status: 202, body: %{}}} end)
  end
end
