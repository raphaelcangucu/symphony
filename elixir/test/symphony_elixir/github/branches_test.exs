defmodule SymphonyElixir.GitHub.BranchesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.Branches

  defmodule FakeClient do
    @moduledoc false

    def rest_get("/repos/o/r/branches?" <> _qs, _opts) do
      {:ok,
       %{
         status: 200,
         body: [
           %{"name" => "main", "protected" => true, "commit" => %{"sha" => "aaa"}},
           %{"name" => "codex/demo-7", "protected" => false, "commit" => %{"sha" => "bbb"}}
         ]
       }}
    end

    def rest_get("/repos/o/r/git/matching-refs/heads/feature/graphql", _opts) do
      {:ok,
       %{
         status: 200,
         body: [
           %{
             "ref" => "refs/heads/feature/graphql-go-api-CDE-1075",
             "object" => %{"sha" => "ccc"}
           }
         ]
       }}
    end

    def rest_get("/repos/o/r/git/matching-refs/heads/" <> _rest, _opts) do
      {:ok, %{status: 200, body: []}}
    end
  end

  test "lists branches across repos with repo + protection metadata" do
    branches = Branches.list_for_project(["o/r"], client_module: FakeClient)

    assert [%{name: "codex/demo-7", repo: "o/r", protected: false, commit_sha: "bbb"}, %{name: "main"}] =
             branches
  end

  test "searches branches by prefix via matching-refs" do
    branches = Branches.search_for_project(["o/r"], "feature/graphql", client_module: FakeClient)

    assert [
             %{
               name: "feature/graphql-go-api-CDE-1075",
               repo: "o/r",
               protected: false,
               commit_sha: "ccc"
             }
           ] = branches
  end

  test "search returns empty for short queries" do
    assert Branches.search_for_project(["o/r"], "f", client_module: FakeClient) == []
  end

  test "never raises when a repo branch read fails" do
    failing = fn _path, _opts -> {:error, :boom} end
    assert Branches.list_for_project(["o/r"], rest_get_fun: failing) == []
  end
end
