defmodule SymphonyElixir.GitHub.BranchStatusTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.BranchStatus

  defmodule StubClient do
    def rest_get(path, opts) do
      send(self(), {:rest_get, path})
      Keyword.fetch!(opts, :request_fun).(nil, nil)
    end
  end

  describe "behind_by/4" do
    test "returns behind_by from the compare payload and hits the compare path" do
      request_fun = fn _url, _headers ->
        {:ok, %{status: 200, body: %{"status" => "diverged", "ahead_by" => 2, "behind_by" => 1}}}
      end

      assert {:ok, 1} =
               BranchStatus.behind_by("acme/app", "homolog", "feat/508",
                 client_module: StubClient,
                 request_fun: request_fun
               )

      assert_received {:rest_get, "/repos/acme/app/compare/homolog...feat/508"}
    end

    test "treats an unexpected body as an error" do
      request_fun = fn _url, _headers -> {:ok, %{status: 200, body: "not-json"}} end

      assert {:error, :unexpected_compare_body} =
               BranchStatus.behind_by("acme/app", "main", "feat/x",
                 client_module: StubClient,
                 request_fun: request_fun
               )
    end

    test "propagates client errors" do
      request_fun = fn _url, _headers -> {:error, {:github_api_status, 404}} end

      assert {:error, {:github_api_status, 404}} =
               BranchStatus.behind_by("acme/app", "main", "fork:feat",
                 client_module: StubClient,
                 request_fun: request_fun
               )
    end
  end
end
