defmodule SymphonyElixir.Claude.UsageTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.AgentUsage.Snapshot
  alias SymphonyElixir.Claude.Usage

  @api_body %{
    "five_hour" => %{"utilization" => 73.5, "resets_at" => 1_900_500_000},
    "seven_day" => %{"utilization" => 21.0, "resets_at" => 1_901_000_000},
    "seven_day_sonnet" => %{"utilization" => 130.0, "resets_at" => 1_901_000_000},
    "extra_usage" => %{"is_enabled" => true, "used_credits" => 12.0, "monthly_limit" => 50.0}
  }

  setup do
    AgentUsage.reset()
    Usage.reset_backoff()
    Application.put_env(:symphony_elixir, :claude_usage_probe_enabled, true)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :claude_usage_probe_enabled) end)
    :ok
  end

  describe "normalize/3" do
    test "maps the Anthropic OAuth usage shape into a Snapshot" do
      snap = Usage.normalize(@api_body, "max", 1_700_000_000)

      assert %Snapshot{agent_kind: "claude", plan: "max"} = snap

      session = Enum.find(snap.windows, &(&1.kind == :session))
      weekly = Enum.find(snap.windows, &(&1.kind == :weekly))
      sonnet = Enum.find(snap.windows, &(&1.kind == :sonnet_weekly))

      assert session.used_percent == 73.5
      assert session.resets_at == 1_900_500_000
      assert weekly.used_percent == 21.0
      # utilization above 100 is clamped
      assert sonnet.used_percent == 100.0
      # extra-usage credits remaining = monthly_limit - used_credits
      assert snap.credits_remaining == 38.0
      refute snap.credits_unlimited
    end

    test "omits absent windows and leaves credits nil without extra_usage" do
      snap = Usage.normalize(%{"five_hour" => %{"utilization" => 10}}, nil, 1_700_000_000)

      assert [%{kind: :session, used_percent: 10.0}] = snap.windows
      assert snap.credits_remaining == nil
      assert snap.plan == nil
    end
  end

  describe "read_credentials/1" do
    test "reads accessToken + subscriptionType + expiresAt from the credentials file" do
      path = write_creds(%{"accessToken" => "tok-123", "subscriptionType" => "max", "expiresAt" => 999})

      assert {:ok, creds} = Usage.read_credentials(path)
      assert creds.access_token == "tok-123"
      assert creds.subscription_type == "max"
      assert creds.expires_at == 999
    end

    test "returns :no_credentials when the file is missing" do
      assert {:error, :no_credentials} = Usage.read_credentials("/tmp/does-not-exist-#{System.unique_integer()}.json")
    end
  end

  describe "fetch/1" do
    test "fetches and normalizes a fresh token without refreshing" do
      path = write_creds(%{"accessToken" => "tok", "subscriptionType" => "pro", "expiresAt" => future_ms()})

      http = fn url, headers ->
        assert url == "https://api.anthropic.com/api/oauth/usage"
        assert {"authorization", "Bearer tok"} in downcase_headers(headers)
        assert {"anthropic-beta", "oauth-2025-04-20"} in downcase_headers(headers)
        {:ok, %{status: 200, body: @api_body}}
      end

      refresh_http = fn _url, _headers, _body -> flunk("must not refresh a fresh token") end

      assert {:ok, %Snapshot{agent_kind: "claude", plan: "pro"} = snap} =
               Usage.fetch(credentials_path: path, http: http, refresh_http: refresh_http)

      assert Enum.any?(snap.windows, &(&1.kind == :session))
    end

    test "refreshes an expired token, persists rotation, then fetches with the new token" do
      path =
        write_creds(%{
          "accessToken" => "old",
          "refreshToken" => "refresh-old",
          "subscriptionType" => "max",
          "expiresAt" => 1
        })

      refresh_http = fn url, _headers, body ->
        assert url == "https://platform.claude.com/v1/oauth/token"
        assert body["grant_type"] == "refresh_token"
        assert body["refresh_token"] == "refresh-old"
        assert body["client_id"] == "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
        {:ok, %{status: 200, body: %{"access_token" => "new", "refresh_token" => "refresh-new", "expires_in" => 3600}}}
      end

      http = fn _url, headers ->
        assert {"authorization", "Bearer new"} in downcase_headers(headers)
        {:ok, %{status: 200, body: @api_body}}
      end

      assert {:ok, %Snapshot{agent_kind: "claude"}} =
               Usage.fetch(credentials_path: path, http: http, refresh_http: refresh_http)

      # rotation is written back so the CLI's refresh token stays valid
      persisted = path |> File.read!() |> Jason.decode!()
      assert persisted["claudeAiOauth"]["accessToken"] == "new"
      assert persisted["claudeAiOauth"]["refreshToken"] == "refresh-new"
    end

    test "retries once with a refreshed token when usage returns 401" do
      path =
        write_creds(%{
          "accessToken" => "tok",
          "refreshToken" => "refresh-old",
          "expiresAt" => future_ms()
        })

      {:ok, calls} = Agent.start_link(fn -> 0 end)

      http = fn _url, _headers ->
        n = Agent.get_and_update(calls, fn n -> {n, n + 1} end)
        if n == 0, do: {:ok, %{status: 401, body: %{}}}, else: {:ok, %{status: 200, body: @api_body}}
      end

      refresh_http = fn _url, _headers, _body ->
        {:ok, %{status: 200, body: %{"access_token" => "new", "expires_in" => 3600}}}
      end

      assert {:ok, %Snapshot{}} = Usage.fetch(credentials_path: path, http: http, refresh_http: refresh_http)
      assert Agent.get(calls, & &1) == 2
    end

    test "maps invalid_grant on refresh to :session_expired" do
      path = write_creds(%{"accessToken" => "tok", "refreshToken" => "r", "expiresAt" => 1})
      http = fn _url, _headers -> flunk("must not call usage when refresh fails") end
      refresh_http = fn _url, _headers, _body -> {:ok, %{status: 400, body: %{"error" => "invalid_grant"}}} end

      assert {:error, :session_expired} =
               Usage.fetch(credentials_path: path, http: http, refresh_http: refresh_http)
    end

    test "errors when an expired token has no refresh token" do
      path = write_creds(%{"accessToken" => "tok", "expiresAt" => 1})
      http = fn _url, _headers -> flunk("must not call usage") end
      refresh_http = fn _url, _headers, _body -> flunk("no refresh token to use") end

      assert {:error, :no_refresh_token} =
               Usage.fetch(credentials_path: path, http: http, refresh_http: refresh_http)
    end
  end

  describe "refresh_into_store/1" do
    test "stores a fetched snapshot under \"claude\"" do
      path = write_creds(%{"accessToken" => "tok", "subscriptionType" => "max", "expiresAt" => future_ms()})
      http = fn _url, _headers -> {:ok, %{status: 200, body: @api_body}} end

      assert :ok = Usage.refresh_into_store(credentials_path: path, http: http)
      assert %Snapshot{agent_kind: "claude", plan: "max"} = AgentUsage.get("claude")
    end

    test "skips when a fresh snapshot already exists" do
      AgentUsage.put("claude", %Snapshot{agent_kind: "claude"})
      http = fn _url, _headers -> flunk("must not fetch when store is fresh") end

      assert :skip = Usage.refresh_into_store(http: http)
    end

    test "skips when disabled by config" do
      Application.put_env(:symphony_elixir, :claude_usage_probe_enabled, false)
      http = fn _url, _headers -> flunk("must not fetch when disabled") end

      assert :skip = Usage.refresh_into_store(http: http)
    end
  end

  defp write_creds(oauth) do
    path = Path.join(System.tmp_dir!(), "claude-creds-#{System.unique_integer([:positive])}.json")
    File.write!(path, Jason.encode!(%{"claudeAiOauth" => oauth}))
    on_exit(fn -> File.rm(path) end)
    path
  end

  defp future_ms, do: System.system_time(:millisecond) + 3_600_000

  defp downcase_headers(headers) do
    Enum.map(headers, fn {k, v} -> {String.downcase(to_string(k)), to_string(v)} end)
  end
end
