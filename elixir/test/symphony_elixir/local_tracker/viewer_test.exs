defmodule SymphonyElixir.LocalTracker.ViewerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Viewer

  defmodule EmptyLoginMock do
    def graphql(_, _, _), do: {:ok, %{"data" => %{"viewer" => %{"login" => "  "}}}}
  end

  defmodule MalformedMock do
    def graphql(_, _, _), do: {:ok, %{"data" => %{}}}
  end

  defmodule ServerErrorMock do
    def graphql(_, _, _), do: {:error, {:github_api_status, 500}}
  end

  defmodule RequestErrorMock do
    def graphql(_, _, _), do: {:error, {:github_api_request, :timeout}}
  end

  defmodule GenericErrorMock do
    def graphql(_, _, _), do: {:error, :offline}
  end

  setup do
    unless Process.whereis(Viewer.Server) do
      {:ok, _pid} = start_supervised(Viewer.Server)
    end

    Viewer.invalidate_cache()

    on_exit(fn -> Viewer.invalidate_cache() end)
    :ok
  end

  describe "current/0" do
    test "returns cached viewer when within TTL" do
      Viewer.put_cached(%{login: "octocat", name: "Octo Cat", avatar_url: "https://x"})

      assert {:ok, %{login: "octocat", name: "Octo Cat", avatar_url: "https://x"}} =
               Viewer.current(request_fun: fn _payload, _headers -> flunk("should not call GraphQL") end)
    end

    test "resolves via GraphQL on cache miss and writes back to cache" do
      System.put_env("GITHUB_TOKEN", "fake")
      on_exit(fn -> System.delete_env("GITHUB_TOKEN") end)

      request_fun = fn _payload, _headers ->
        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "viewer" => %{
                 "login" => "octocat",
                 "name" => "Octo Cat",
                 "avatarUrl" => "https://avatar"
               }
             }
           }
         }}
      end

      assert {:ok, %{login: "octocat", name: "Octo Cat", avatar_url: "https://avatar"}} =
               Viewer.current(request_fun: request_fun)

      assert {:ok, %{login: "octocat"}} =
               Viewer.current(request_fun: fn _, _ -> flunk("should hit cache") end)
    end

    test "returns :missing_github_token error when token absent" do
      System.delete_env("GITHUB_TOKEN")

      assert {:error, :missing_github_token} = Viewer.current()
    end

    test "maps 401 GraphQL status to :unauthorized" do
      System.put_env("GITHUB_TOKEN", "fake")
      on_exit(fn -> System.delete_env("GITHUB_TOKEN") end)

      request_fun = fn _payload, _headers -> {:ok, %{status: 401, body: ~s({"message":"Bad credentials"})}} end

      assert {:error, :unauthorized} = Viewer.current(request_fun: request_fun)
    end

    test "current!/1 returns viewer on success" do
      Viewer.put_cached(%{login: "octocat", name: nil, avatar_url: nil})

      assert %{login: "octocat"} = Viewer.current!()
    end

    test "current!/1 raises when viewer unavailable" do
      System.delete_env("GITHUB_TOKEN")

      assert_raise RuntimeError, ~r/viewer unavailable: :missing_github_token/, fn ->
        Viewer.current!()
      end
    end

    test "returns malformed_response for unexpected GraphQL payload" do
      assert {:error, {:malformed_response, _body}} = Viewer.current(client_module: MalformedMock)
    end

    test "returns malformed_response for empty login" do
      assert {:error, {:malformed_response, _node}} = Viewer.current(client_module: EmptyLoginMock)
    end

    test "maps non-401 HTTP status to network_error" do
      assert {:error, {:network_error, {:http_status, 500}}} =
               Viewer.current(client_module: ServerErrorMock)
    end

    test "maps github_api_request errors to network_error" do
      assert {:error, {:network_error, :timeout}} = Viewer.current(client_module: RequestErrorMock)
    end

    test "maps other client errors to network_error" do
      assert {:error, {:network_error, :offline}} = Viewer.current(client_module: GenericErrorMock)
    end

    test "re-resolves after cache entry expires" do
      previous_ttl = Application.get_env(:symphony_elixir, :viewer_cache_ttl_ms)
      Application.put_env(:symphony_elixir, :viewer_cache_ttl_ms, -1)
      on_exit(fn -> Application.put_env(:symphony_elixir, :viewer_cache_ttl_ms, previous_ttl) end)

      Viewer.put_cached(%{login: "stale", name: nil, avatar_url: nil})

      request_fun = fn _payload, _headers ->
        {:ok,
         %{
           status: 200,
           body: %{"data" => %{"viewer" => %{"login" => "fresh", "name" => nil, "avatarUrl" => nil}}}
         }}
      end

      System.put_env("GITHUB_TOKEN", "fake")
      on_exit(fn -> System.delete_env("GITHUB_TOKEN") end)

      assert {:ok, %{login: "fresh"}} = Viewer.current(request_fun: request_fun)
    end
  end
end
