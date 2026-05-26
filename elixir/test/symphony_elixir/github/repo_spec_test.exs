defmodule SymphonyElixir.GitHub.RepoSpecTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.RepoSpec

  describe "split/1" do
    test "splits a valid owner/repo pair" do
      assert {:ok, {"owner", "name"}} = RepoSpec.split("owner/name")
    end

    test "accepts nested-looking names by capping parts at 2" do
      assert {:ok, {"owner", "weird/name"}} = RepoSpec.split("owner/weird/name")
    end

    test "returns :missing_github_repo when given nil" do
      assert {:error, :missing_github_repo} = RepoSpec.split(nil)
    end

    test "returns :invalid_github_repo when input has no slash" do
      assert {:error, {:invalid_github_repo, "owneronly"}} = RepoSpec.split("owneronly")
    end

    test "returns :invalid_github_repo when owner is blank" do
      assert {:error, {:invalid_github_repo, "/name"}} = RepoSpec.split("/name")
    end

    test "returns :invalid_github_repo when name is blank" do
      assert {:error, {:invalid_github_repo, "owner/"}} = RepoSpec.split("owner/")
    end
  end
end
