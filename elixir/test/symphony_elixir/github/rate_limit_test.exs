defmodule SymphonyElixir.GitHub.RateLimitTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.RateLimit

  describe "rate_limited?/1" do
    test "treats a 429 status as rate limited" do
      assert RateLimit.rate_limited?(%{status: 429, headers: %{}, body: %{}})
    end

    test "treats a 403 with x-ratelimit-remaining: 0 as rate limited" do
      assert RateLimit.rate_limited?(%{status: 403, headers: %{"x-ratelimit-remaining" => ["0"]}, body: %{}})
    end

    test "does not treat a 403 with remaining budget as rate limited" do
      refute RateLimit.rate_limited?(%{status: 403, headers: %{"x-ratelimit-remaining" => ["4999"]}, body: %{}})
    end

    test "treats a 200 GraphQL body carrying a RATE_LIMIT error as rate limited" do
      response = %{
        status: 200,
        headers: %{},
        body: %{"errors" => [%{"type" => "RATE_LIMIT", "code" => "graphql_rate_limit"}]}
      }

      assert RateLimit.rate_limited?(response)
    end

    test "does not treat an ordinary 200 body as rate limited" do
      refute RateLimit.rate_limited?(%{status: 200, headers: %{}, body: %{"data" => %{}}})
    end

    test "does not treat an unrelated error body as rate limited" do
      refute RateLimit.rate_limited?(%{status: 200, headers: %{}, body: %{"errors" => [%{"message" => "nope"}]}})
    end
  end

  describe "retry_delay_ms/3" do
    test "honors the Retry-After header (seconds) above everything else" do
      response = %{
        status: 429,
        headers: %{"retry-after" => ["30"], "x-ratelimit-reset" => ["9999999999"]},
        body: %{}
      }

      assert RateLimit.retry_delay_ms(response, 1) == 30_000
    end

    test "falls back to x-ratelimit-reset relative to now" do
      now = ~U[2026-01-01 00:00:00Z]
      reset_unix = DateTime.to_unix(DateTime.add(now, 45, :second))

      response = %{status: 403, headers: %{"x-ratelimit-reset" => [Integer.to_string(reset_unix)]}, body: %{}}

      assert RateLimit.retry_delay_ms(response, 1, now: now) == 45_000
    end

    test "clamps a stale reset time to zero" do
      now = ~U[2026-01-01 00:00:00Z]
      reset_unix = DateTime.to_unix(DateTime.add(now, -10, :second))

      response = %{status: 403, headers: %{"x-ratelimit-reset" => [Integer.to_string(reset_unix)]}, body: %{}}

      assert RateLimit.retry_delay_ms(response, 1, now: now) == 0
    end

    test "uses exponential backoff when no headers are present" do
      response = %{status: 429, headers: %{}, body: %{}}

      assert RateLimit.retry_delay_ms(response, 1, base_backoff_ms: 1_000) == 1_000
      assert RateLimit.retry_delay_ms(response, 2, base_backoff_ms: 1_000) == 2_000
      assert RateLimit.retry_delay_ms(response, 3, base_backoff_ms: 1_000) == 4_000
    end

    test "caps exponential backoff at max_backoff_ms" do
      response = %{status: 429, headers: %{}, body: %{}}

      assert RateLimit.retry_delay_ms(response, 10, base_backoff_ms: 1_000, max_backoff_ms: 5_000) == 5_000
    end
  end

  describe "reset_info/1" do
    test "parses x-ratelimit-reset into a DateTime" do
      assert %{reset_at: %DateTime{} = reset_at} =
               RateLimit.reset_info(%{status: 429, headers: %{"x-ratelimit-reset" => ["1780146793"]}, body: %{}})

      assert DateTime.to_unix(reset_at) == 1_780_146_793
    end

    test "returns nil when the header is missing" do
      assert %{reset_at: nil} = RateLimit.reset_info(%{status: 429, headers: %{}, body: %{}})
    end
  end
end
