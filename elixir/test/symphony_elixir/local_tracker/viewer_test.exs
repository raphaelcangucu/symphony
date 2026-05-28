defmodule SymphonyElixir.LocalTracker.ViewerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Viewer

  setup do
    unless Process.whereis(Viewer.Server) do
      {:ok, _pid} = start_supervised(Viewer.Server)
    end

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
  end
end
