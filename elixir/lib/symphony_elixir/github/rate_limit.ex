defmodule SymphonyElixir.GitHub.RateLimit do
  @moduledoc """
  Shared GitHub rate-limit detection and backoff helpers.

  GitHub signals rate limiting in several ways:

  - a `429 Too Many Requests` status (primary or secondary limits);
  - a `403 Forbidden` status with `x-ratelimit-remaining: 0`;
  - a `200 OK` GraphQL body whose `errors` carry `type: "RATE_LIMIT"` /
    `code: "graphql_rate_limit"`.

  Both `SymphonyElixir.GitHub.Client` (response classification) and
  `SymphonyElixir.GitHub.RequestGateway` (serialized backoff) rely on this module
  so the detection rules and retry timing stay consistent across REST and GraphQL.
  """

  @default_base_backoff_ms 1_000
  @default_max_backoff_ms 60_000

  @type response :: %{optional(:status) => integer(), optional(:headers) => term(), optional(:body) => term()}

  @doc """
  Returns `true` when the GitHub response indicates a primary or secondary rate limit.
  """
  @spec rate_limited?(response()) :: boolean()
  def rate_limited?(%{status: 429}), do: true
  def rate_limited?(%{status: 403} = response), do: remaining_exhausted?(response) or body_rate_limit?(response)
  def rate_limited?(%{status: 200} = response), do: body_rate_limit?(response)
  def rate_limited?(_response), do: false

  @doc """
  Builds the `%{reset_at: DateTime.t() | nil}` payload carried by `{:rate_limited, info}`.
  """
  @spec reset_info(response()) :: %{reset_at: DateTime.t() | nil}
  def reset_info(response) do
    %{reset_at: parse_reset_at(header_value(response, "x-ratelimit-reset"))}
  end

  @doc """
  Computes how long to wait before retrying, honoring GitHub's guidance.

  Precedence:

  1. `retry-after` header (seconds) — used by secondary rate limits;
  2. `x-ratelimit-reset` header (UTC epoch seconds) — used by primary limits;
  3. exponential backoff `base * 2 ^ (attempt - 1)` capped at `max_backoff_ms`.

  `attempt` is 1-based. Options: `:base_backoff_ms`, `:max_backoff_ms`, and `:now`
  (a `DateTime` injected for deterministic tests).
  """
  @spec retry_delay_ms(response(), pos_integer(), keyword()) :: non_neg_integer()
  def retry_delay_ms(response, attempt, opts \\ []) when is_integer(attempt) and attempt >= 1 do
    cond do
      (retry_after = retry_after_ms(response)) != nil -> retry_after
      (reset = reset_delay_ms(response, opts)) != nil -> reset
      true -> backoff_ms(attempt, opts)
    end
  end

  defp retry_after_ms(response) do
    with value when is_binary(value) <- header_value(response, "retry-after"),
         {seconds, _rest} <- Integer.parse(String.trim(value)),
         true <- seconds >= 0 do
      seconds * 1_000
    else
      _ -> nil
    end
  end

  defp reset_delay_ms(response, opts) do
    case parse_reset_at(header_value(response, "x-ratelimit-reset")) do
      %DateTime{} = reset_at ->
        now = Keyword.get(opts, :now, DateTime.utc_now())
        max(DateTime.diff(reset_at, now, :millisecond), 0)

      _ ->
        nil
    end
  end

  defp backoff_ms(attempt, opts) do
    base = Keyword.get(opts, :base_backoff_ms, @default_base_backoff_ms)
    cap = Keyword.get(opts, :max_backoff_ms, @default_max_backoff_ms)

    (base * Integer.pow(2, attempt - 1))
    |> min(cap)
    |> max(0)
  end

  defp remaining_exhausted?(response), do: header_value(response, "x-ratelimit-remaining") == "0"

  @doc """
  Returns `true` when a decoded GraphQL `errors` list carries a rate-limit error.
  Used by `Client.classify_graphql_response/2` for `200 OK` bodies.
  """
  @spec rate_limit_errors?(term()) :: boolean()
  def rate_limit_errors?(errors) when is_list(errors), do: Enum.any?(errors, &rate_limit_error?/1)
  def rate_limit_errors?(_errors), do: false

  defp body_rate_limit?(response) do
    response
    |> extract_errors()
    |> rate_limit_errors?()
  end

  defp extract_errors(%{body: %{"errors" => errors}}) when is_list(errors), do: errors
  defp extract_errors(_response), do: []

  defp rate_limit_error?(error) when is_map(error) do
    type = Map.get(error, "type")
    code = Map.get(error, "code")

    (is_binary(type) and String.upcase(type) in ["RATE_LIMIT", "RATE_LIMITED"]) or
      (is_binary(code) and String.downcase(code) in ["graphql_rate_limit", "rate_limited"])
  end

  defp rate_limit_error?(_error), do: false

  defp parse_reset_at(value) when is_binary(value) do
    with {unix, _rest} <- Integer.parse(String.trim(value)),
         {:ok, datetime} <- DateTime.from_unix(unix) do
      datetime
    else
      _ -> nil
    end
  end

  defp parse_reset_at(_value), do: nil

  defp header_value(%{headers: headers}, name) when is_map(headers) do
    case Map.get(headers, name) do
      [value | _] when is_binary(value) -> value
      value when is_binary(value) -> value
      _ -> nil
    end
  end

  defp header_value(%{headers: headers}, name) when is_list(headers) do
    Enum.find_value(headers, fn
      {key, value} -> if String.downcase(to_string(key)) == name, do: to_string(value)
      _ -> nil
    end)
  end

  defp header_value(_response, _name), do: nil
end
