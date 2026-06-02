defmodule SymphonyElixir.GitHub.PullRequestUrlTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.PullRequestUrl

  test "parses owner/name/number from a PR url" do
    assert {:ok, %{repo: "clouapp/back", owner: "clouapp", name: "back", number: 277}} =
             PullRequestUrl.parse("https://github.com/clouapp/back/pull/277")
  end

  test "tolerates trailing path and query" do
    assert {:ok, %{number: 277}} =
             PullRequestUrl.parse("https://github.com/clouapp/back/pull/277/files?w=1")
  end

  test "rejects non-PR urls" do
    assert {:error, :invalid_pr_url} = PullRequestUrl.parse("https://github.com/clouapp/back/issues/10")
    assert {:error, :invalid_pr_url} = PullRequestUrl.parse("not a url")
    assert {:error, :invalid_pr_url} = PullRequestUrl.parse(nil)
  end
end
