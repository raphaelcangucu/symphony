defmodule SymphonyElixir.PullRequestBranchUpdateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.PullRequestBranchUpdate

  defmodule AcceptedClient do
    def rest_put(path, _body, _opts) do
      send(self(), {:put, path})
      {:ok, %{status: 202, body: %{}}}
    end
  end

  defmodule ConflictClient do
    def rest_put(_path, _body, _opts), do: {:error, {:github_api_status, 422}}
  end

  defp github_project do
    %Project{tracker_kind: "github", tracker_config: %{"repo" => "acme/app"}}
  end

  describe "update/3" do
    test "returns {:ok, :accepted} on 202 and calls the update-branch path" do
      assert {:ok, :accepted} =
               PullRequestBranchUpdate.update(github_project(), 509, client_module: AcceptedClient)

      assert_received {:put, "/repos/acme/app/pulls/509/update-branch"}
    end

    test "uses an explicit repo override for multi-repo projects" do
      assert {:ok, :accepted} =
               PullRequestBranchUpdate.update(github_project(), 509,
                 client_module: AcceptedClient,
                 repo: "acme/backend"
               )

      assert_received {:put, "/repos/acme/backend/pulls/509/update-branch"}
    end

    test "maps a 422 to :update_branch_conflict" do
      assert {:error, :update_branch_conflict} =
               PullRequestBranchUpdate.update(github_project(), 509, client_module: ConflictClient)
    end

    test "rejects non-github projects" do
      project = %Project{tracker_kind: "local", tracker_config: %{}}

      assert {:error, {:unsupported_tracker_kind, "local"}} =
               PullRequestBranchUpdate.update(project, 509, client_module: AcceptedClient)
    end
  end
end
