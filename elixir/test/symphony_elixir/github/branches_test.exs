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
  end

  test "lists branches across repos with repo + protection metadata" do
    branches = Branches.list_for_project(["o/r"], client_module: FakeClient)

    assert [%{name: "codex/demo-7", repo: "o/r", protected: false, commit_sha: "bbb"}, %{name: "main"}] =
             branches
  end

  test "never raises when a repo branch read fails" do
    failing = fn _path, _opts -> {:error, :boom} end
    assert Branches.list_for_project(["o/r"], rest_get_fun: failing) == []
  end
end
