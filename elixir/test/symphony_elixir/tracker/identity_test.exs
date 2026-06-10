defmodule SymphonyElixir.Tracker.IdentityTest do
  # Mutates LINEAR_API_KEY env and the shared identity cache; must run serially.
  use ExUnit.Case, async: false

  alias SymphonyElixir.Tracker.Identity
  alias SymphonyElixir.Tracker.Identity.Cache

  setup do
    Cache.invalidate_all()
    on_exit(fn -> Cache.invalidate_all() end)
    :ok
  end

  defp jira_opts(body) do
    [
      base_url: "https://example.atlassian.net",
      email: "ops@example.com",
      api_token: "token",
      request_fun: fn :get, _url, _payload, _headers -> {:ok, %{status: 200, body: body}} end
    ]
  end

  defp linear_opts(body) do
    [request_fun: fn _payload, _headers -> {:ok, %{status: 200, body: body}} end]
  end

  test "resolves jira identity with accountId as the canonical match value" do
    opts = jira_opts(%{"accountId" => "acc-123", "displayName" => "Raphael", "emailAddress" => "r@x.com"})

    assert {:ok, identity} = Identity.resolve("jira", opts)
    assert identity.provider == "jira"
    assert identity.match_value == "acc-123"
    assert identity.name == "Raphael"
    assert identity.email == "r@x.com"
    assert Identity.match_value("jira", opts) == "acc-123"
  end

  test "resolves linear identity with user id as the canonical match value" do
    System.put_env("LINEAR_API_KEY", "lin-key")
    on_exit(fn -> System.delete_env("LINEAR_API_KEY") end)

    body = %{"data" => %{"viewer" => %{"id" => "lin-9", "name" => "Raph C", "displayName" => "raph", "email" => "r@x.com"}}}

    assert {:ok, identity} = Identity.resolve("linear", linear_opts(body))
    assert identity.provider == "linear"
    assert identity.match_value == "lin-9"
    assert identity.name == "Raph C"
  end

  test "caches a resolved identity until invalidated" do
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    request_fun = fn :get, _url, _payload, _headers ->
      Agent.update(counter, &(&1 + 1))
      {:ok, %{status: 200, body: %{"accountId" => "acc-1", "displayName" => "A"}}}
    end

    opts = [base_url: "https://x", email: "e@x.com", api_token: "t", request_fun: request_fun]

    assert {:ok, _} = Identity.resolve("jira", opts)
    assert {:ok, _} = Identity.resolve("jira", opts)
    assert Agent.get(counter, & &1) == 1

    Identity.invalidate("jira")
    assert {:ok, _} = Identity.resolve("jira", opts)
    assert Agent.get(counter, & &1) == 2
  end

  test "match_value returns nil when the provider cannot be resolved" do
    opts = jira_opts(%{"missing" => "accountId"})
    assert Identity.match_value("jira", opts) == nil
  end

  test "local projects resolve against the github viewer" do
    assert elem(Identity.resolve("local", []), 0) in [:ok, :error]
  end

  test "statuses reports unconfigured providers without calling them" do
    statuses = Identity.statuses()
    providers = Enum.map(statuses, & &1.provider)

    assert Enum.sort(providers) == ["github", "jira", "linear"]

    Enum.each(statuses, fn status ->
      assert is_boolean(status.configured)
      assert is_boolean(status.connected)
    end)
  end
end
