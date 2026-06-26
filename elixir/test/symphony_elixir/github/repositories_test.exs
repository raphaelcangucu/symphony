defmodule SymphonyElixir.GitHub.RepositoriesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.Repositories

  # Mirrors the real `GitHub.Client.rest_get/2`, which classifies a 404 into
  # `{:error, {:github_api_status, 404}}` instead of `{:ok, %{status: 404}}`.
  defmodule StubMissing do
    def rest_get("/repos/octocat/symphony-kb", _), do: {:error, {:github_api_status, 404}}

    def rest_post("/user/repos", body, _) do
      send(self(), {:created, body})

      {:ok,
       %{
         status: 201,
         body: %{
           "full_name" => "octocat/symphony-kb",
           "clone_url" => "https://github.com/octocat/symphony-kb.git",
           "default_branch" => "main",
           "private" => true
         }
       }}
    end
  end

  # A stub that returns the raw `{:ok, %{status: 404}}` shape (e.g. a future or
  # alternate client) must still trigger creation.
  defmodule StubMissingOkShape do
    def rest_get("/repos/octocat/symphony-kb", _), do: {:ok, %{status: 404, body: %{}}}

    def rest_post("/user/repos", _body, _),
      do:
        {:ok,
         %{
           status: 201,
           body: %{
             "full_name" => "octocat/symphony-kb",
             "clone_url" => "https://github.com/octocat/symphony-kb.git",
             "default_branch" => "main",
             "private" => true
           }
         }}
  end

  defmodule StubCreateFails do
    def rest_get("/repos/octocat/symphony-kb", _), do: {:error, {:github_api_status, 404}}
    def rest_post("/user/repos", _body, _), do: {:error, {:github_api_status, 422}}
  end

  defmodule StubExisting do
    def rest_get("/repos/octocat/symphony-kb", _),
      do:
        {:ok,
         %{
           status: 200,
           body: %{
             "full_name" => "octocat/symphony-kb",
             "clone_url" => "https://github.com/octocat/symphony-kb.git",
             "default_branch" => "main",
             "private" => true
           }
         }}
  end

  test "creates the private repo when the client reports a 404 error tuple" do
    assert {:ok, repo} = Repositories.ensure("symphony-kb", login: "octocat", client: StubMissing)
    assert repo.full_name == "octocat/symphony-kb"
    assert repo.created == true
    assert_received {:created, %{"name" => "symphony-kb", "private" => true, "auto_init" => true}}
  end

  test "creates the private repo when the client reports a raw 404 ok tuple" do
    assert {:ok, repo} =
             Repositories.ensure("symphony-kb", login: "octocat", client: StubMissingOkShape)

    assert repo.created == true
    assert repo.clone_url =~ "symphony-kb.git"
  end

  test "returns the existing repo without creating" do
    assert {:ok, repo} = Repositories.ensure("symphony-kb", login: "octocat", client: StubExisting)
    assert repo.created == false
    assert repo.clone_url =~ "symphony-kb.git"
  end

  test "maps a creation failure to kb_repo_create_failed" do
    assert {:error, {:kb_repo_create_failed, 422}} =
             Repositories.ensure("symphony-kb", login: "octocat", client: StubCreateFails)
  end
end
