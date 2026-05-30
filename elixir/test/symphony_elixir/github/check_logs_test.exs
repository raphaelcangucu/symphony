defmodule SymphonyElixir.GitHub.CheckLogsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.CheckLogs

  defmodule StubClient do
    def rest_get(_path, opts) do
      Keyword.fetch!(opts, :request_fun).(nil, nil)
    end
  end

  describe "clean_and_tail/1" do
    test "strips timestamps and ANSI, keeps the tail" do
      raw =
        Enum.map_join(1..300, "\n", fn i ->
          "2026-05-29T02:43:46.2845216Z \e[31mline #{i}\e[39m"
        end)

      result = CheckLogs.clean_and_tail(raw)

      refute result =~ "2026-05-29T02:43:46"
      refute result =~ "\e["
      refute result =~ "line 1\n"
      assert result =~ "line 300"
    end

    test "caps very large single-line output by characters" do
      raw = "2026-05-29T00:00:00Z " <> String.duplicate("x", 50_000)
      assert String.length(CheckLogs.clean_and_tail(raw)) <= 8_000
    end
  end

  describe "failing_job_excerpt/3" do
    test "returns cleaned excerpt for a job id" do
      request_fun = fn _url, _headers ->
        {:ok, %{status: 200, body: "2026-05-29T02:43:46Z ##[error]Process completed with exit code 1."}}
      end

      assert {:ok, excerpt} =
               CheckLogs.failing_job_excerpt("acme/app", 9, client_module: StubClient, request_fun: request_fun)

      assert excerpt =~ "##[error]Process completed with exit code 1."
      refute excerpt =~ "2026-05-29T02:43:46Z"
    end

    test "propagates client errors" do
      request_fun = fn _url, _headers -> {:error, {:github_api_status, 404}} end

      assert {:error, {:github_api_status, 404}} =
               CheckLogs.failing_job_excerpt("acme/app", 9, client_module: StubClient, request_fun: request_fun)
    end
  end
end
