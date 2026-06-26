defmodule SymphonyElixir.GitHub.PullRequestCreateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.PullRequestCreate

  defmodule StubNoExisting do
    import ExUnit.Assertions

    def rest_get("/repos/acme/web", _opts),
      do: {:ok, %{status: 200, body: %{"default_branch" => "main"}}}

    def rest_get("/repos/acme/web/pulls" <> _q, _opts), do: {:ok, %{status: 200, body: []}}

    def rest_post("/repos/acme/web/pulls", body, _opts) do
      assert body["head"] == "symphony-docs" and body["base"] == "main"
      {:ok, %{status: 201, body: %{"number" => 42, "html_url" => "https://github.com/acme/web/pull/42"}}}
    end
  end

  defmodule StubExisting do
    def rest_get("/repos/acme/web", _opts),
      do: {:ok, %{status: 200, body: %{"default_branch" => "main"}}}

    def rest_get("/repos/acme/web/pulls" <> _q, _opts),
      do: {:ok, %{status: 200, body: [%{"number" => 7, "html_url" => "https://github.com/acme/web/pull/7"}]}}
  end

  test "creates a new PR when none exists" do
    assert {:ok, %{number: 42, url: "https://github.com/acme/web/pull/42", created: true}} =
             PullRequestCreate.ensure("acme/web", "symphony-docs", client: StubNoExisting)
  end

  test "returns the existing open PR for the head branch" do
    assert {:ok, %{number: 7, created: false}} =
             PullRequestCreate.ensure("acme/web", "symphony-docs", client: StubExisting)
  end
end
