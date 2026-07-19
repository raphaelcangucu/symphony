defmodule SymphonyElixir.PullRequestMergeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.PullRequestMerge

  defmodule AcceptedClient do
    def rest_put(path, body, _opts) do
      send(self(), {:put, path, body})
      {:ok, %{status: 200, body: %{"merged" => true, "sha" => "abc123", "message" => "Pull Request successfully merged"}}}
    end
  end

  defmodule MethodNotAllowedClient do
    def rest_put(_path, _body, _opts), do: {:error, {:github_api_status, 405}}
  end

  defmodule ConflictClient do
    def rest_put(_path, _body, _opts), do: {:error, {:github_api_status, 409}}
  end

  defmodule ValidationClient do
    def rest_put(_path, _body, _opts), do: {:error, {:github_api_status, 422}}
  end

  defmodule ForbiddenClient do
    def rest_put(_path, _body, _opts), do: {:error, {:github_api_status, 403}}
  end

  defmodule UnconfirmedClient do
    def rest_put(_path, _body, _opts), do: {:ok, %{status: 200, body: %{"merged" => false}}}
  end

  describe "merge/4" do
    test "merges a pull request with the selected method" do
      assert {:ok, result} =
               PullRequestMerge.merge(github_project(), 509, "squash", client_module: AcceptedClient)

      assert result.merged == true
      assert result.method == "squash"
      assert result.bypass == false
      assert_received {:put, "/repos/acme/app/pulls/509/merge", %{merge_method: "squash"}}
    end

    test "accepts force intent without sending unsupported GitHub fields" do
      assert {:ok, result} =
               PullRequestMerge.merge(github_project(), 509, :rebase,
                 bypass: true,
                 client_module: AcceptedClient
               )

      assert result.bypass == true
      assert result.method == "rebase"
      assert_received {:put, "/repos/acme/app/pulls/509/merge", %{merge_method: "rebase"}}
    end

    test "uses an explicit repo override for multi-repo projects" do
      assert {:ok, result} =
               PullRequestMerge.merge(github_project(), 509, "squash",
                 client_module: AcceptedClient,
                 repo: "acme/backend"
               )

      assert result.merged == true
      assert_received {:put, "/repos/acme/backend/pulls/509/merge", %{merge_method: "squash"}}
    end

    test "rejects unsupported merge methods before calling GitHub" do
      assert {:error, :invalid_merge_method} =
               PullRequestMerge.merge(github_project(), 509, "octopus", client_module: AcceptedClient)

      refute_received {:put, _path, _body}
    end

    test "maps GitHub merge failures to user-facing reasons" do
      assert {:error, :pull_request_not_mergeable} =
               PullRequestMerge.merge(github_project(), 509, "merge", client_module: MethodNotAllowedClient)

      assert {:error, :pull_request_merge_conflict} =
               PullRequestMerge.merge(github_project(), 509, "merge", client_module: ConflictClient)

      assert {:error, :pull_request_merge_blocked} =
               PullRequestMerge.merge(github_project(), 509, "merge", client_module: ValidationClient)

      assert {:error, :pull_request_merge_forbidden} =
               PullRequestMerge.merge(github_project(), 509, "merge", client_module: ForbiddenClient)
    end

    test "rejects a successful response that does not confirm the merge" do
      assert {:error, :pull_request_not_mergeable} =
               PullRequestMerge.merge(github_project(), 509, "merge", client_module: UnconfirmedClient)
    end

    test "rejects non-github projects" do
      project = %Project{tracker_kind: "local", tracker_config: %{}}

      assert {:error, {:unsupported_tracker_kind, "local"}} =
               PullRequestMerge.merge(project, 509, "merge", client_module: AcceptedClient)
    end
  end

  defp github_project do
    %Project{tracker_kind: "github", tracker_config: %{"repo" => "acme/app"}}
  end
end
