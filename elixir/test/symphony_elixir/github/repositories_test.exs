defmodule SymphonyElixir.GitHub.RepositoriesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.Repositories

  defmodule StubMissing do
    def rest_get("/repos/octocat/symphony-kb", _), do: {:ok, %{status: 404, body: %{}}}

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

  test "creates the private repo when it does not exist" do
    assert {:ok, repo} = Repositories.ensure("symphony-kb", login: "octocat", client: StubMissing)
    assert repo.full_name == "octocat/symphony-kb"
    assert repo.created == true
    assert_received {:created, %{"name" => "symphony-kb", "private" => true, "auto_init" => true}}
  end

  test "returns the existing repo without creating" do
    assert {:ok, repo} = Repositories.ensure("symphony-kb", login: "octocat", client: StubExisting)
    assert repo.created == false
    assert repo.clone_url =~ "symphony-kb.git"
  end
end
