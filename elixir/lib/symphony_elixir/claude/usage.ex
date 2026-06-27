defmodule SymphonyElixir.Claude.Usage do
  @moduledoc """
  Active probe for Claude plan usage.

  Unlike Codex (whose `rate_limits` flow through the app-server stream and are
  captured passively in `SymphonyElixir.Observability.Registry`), Claude exposes
  plan usage only via an authenticated HTTP endpoint. This module mirrors the
  approach the Jean desktop app uses: it reads the Claude CLI OAuth token from
  `~/.claude/.credentials.json` and calls Anthropic's OAuth usage API, then
  normalizes the response into a `SymphonyElixir.AgentUsage.Snapshot` and stores
  it under `"claude"`.

  The live endpoint is undocumented and OAuth-token-gated, so every step fails
  soft: a missing/expired token or a non-2xx response yields `{:error, reason}`
  and never crashes the caller. Token refresh is intentionally out of scope for
  now — an expired token surfaces as `:token_expired` so the operator re-auths
  via `claude`.
  """

  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.AgentUsage.Snapshot
  alias SymphonyElixir.AgentUsage.Window

  require Logger

  @agent_kind "claude"
  @credentials_file ".claude/.credentials.json"
  @usage_url "https://api.anthropic.com/api/oauth/usage"
  @beta_header {"anthropic-beta", "oauth-2025-04-20"}
  @request_timeout_ms 5_000
  @backoff_ms 60_000
  @backoff_key {__MODULE__, :last_attempt_ms}

  @type credentials :: %{
          access_token: String.t(),
          expires_at: integer() | nil,
          subscription_type: String.t() | nil
        }

  @type http_fun :: (String.t(), [{String.t(), String.t()}] -> {:ok, map()} | {:error, term()})

  # ── Public API ──────────────────────────────────────────────────────────────

  @doc """
  Fetch + normalize Claude usage and write it into the `AgentUsage` store.

  Returns `:skip` when disabled, when a fresh snapshot already exists, or when a
  recent attempt is still inside the backoff window. Returns `{:error, reason}`
  when a fetch was attempted but failed.
  """
  @spec refresh_into_store(keyword()) :: :ok | :skip | {:error, term()}
  def refresh_into_store(opts \\ []) do
    cond do
      not enabled?() -> :skip
      fresh_in_store?() -> :skip
      not due?() -> :skip
      true -> attempt_refresh(opts)
    end
  end

  @doc "Fetch + normalize Claude usage without touching the store."
  @spec fetch(keyword()) :: {:ok, Snapshot.t()} | {:error, term()}
  def fetch(opts \\ []) do
    now_ms = Keyword.get(opts, :now_ms, System.system_time(:millisecond))

    with {:ok, creds} <- read_credentials(credentials_path(opts)),
         :ok <- ensure_token_live(creds, now_ms),
         {:ok, body} <- request_usage(creds.access_token, opts) do
      {:ok, normalize(body, creds.subscription_type, System.system_time(:second))}
    end
  end

  @doc """
  Normalize the Anthropic OAuth usage payload into a `Snapshot`.

  Window mapping mirrors Jean: `five_hour → :session`, `seven_day → :weekly`,
  `seven_day_sonnet → :sonnet_weekly`; each carries `utilization → used_percent`
  (clamped 0..100) and `resets_at` (absolute epoch seconds). `extra_usage`
  becomes `credits_remaining = monthly_limit - used_credits` when enabled.
  """
  @spec normalize(map(), String.t() | nil, integer()) :: Snapshot.t()
  def normalize(body, plan, _now) when is_map(body) do
    %Snapshot{
      agent_kind: @agent_kind,
      plan: blank_to_nil(plan),
      windows: build_windows(body),
      model_limits: [],
      credits_remaining: credits_remaining(body),
      credits_unlimited: false
    }
  end

  @doc "Read and parse the Claude CLI OAuth credentials file."
  @spec read_credentials(String.t()) :: {:ok, credentials()} | {:error, atom()}
  def read_credentials(path) when is_binary(path) do
    with {:ok, raw} <- read_file(path),
         {:ok, json} <- decode_json(raw),
         {:ok, oauth} <- fetch_oauth(json),
         {:ok, token} <- fetch_access_token(oauth) do
      {:ok,
       %{
         access_token: token,
         expires_at: to_integer(Map.get(oauth, "expiresAt")),
         subscription_type: blank_to_nil(Map.get(oauth, "subscriptionType"))
       }}
    end
  end

  @doc "Default credentials path (`~/.claude/.credentials.json`)."
  @spec default_credentials_path() :: String.t()
  def default_credentials_path do
    case System.user_home() do
      home when is_binary(home) and home != "" -> Path.join(home, @credentials_file)
      _ -> Path.expand("~/" <> @credentials_file)
    end
  end

  @doc false
  @spec reset_backoff() :: :ok
  def reset_backoff do
    :persistent_term.erase(@backoff_key)
    :ok
  end

  # ── Refresh helpers ─────────────────────────────────────────────────────────

  defp attempt_refresh(opts) do
    mark_attempt()

    case safe_fetch(opts) do
      {:ok, %Snapshot{} = snapshot} ->
        AgentUsage.put(@agent_kind, snapshot)
        :ok

      {:error, reason} ->
        Logger.debug("Claude usage probe failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  defp safe_fetch(opts) do
    fetch(opts)
  rescue
    error -> {:error, {:exception, error}}
  catch
    kind, value -> {:error, {kind, value}}
  end

  defp enabled? do
    Application.get_env(:symphony_elixir, :claude_usage_probe_enabled, true) == true
  end

  defp fresh_in_store? do
    not is_nil(AgentUsage.get(@agent_kind)) and not AgentUsage.stale?(@agent_kind)
  end

  defp due? do
    last = :persistent_term.get(@backoff_key, nil)
    is_nil(last) or System.monotonic_time(:millisecond) - last >= @backoff_ms
  end

  defp mark_attempt do
    :persistent_term.put(@backoff_key, System.monotonic_time(:millisecond))
  end

  # ── HTTP ────────────────────────────────────────────────────────────────────

  defp request_usage(access_token, opts) do
    headers = [
      {"authorization", "Bearer " <> String.trim(access_token)},
      {"accept", "application/json"},
      {"content-type", "application/json"},
      @beta_header
    ]

    http = Keyword.get(opts, :http, &default_http/2)

    case http.(@usage_url, headers) do
      {:ok, %{status: status, body: body}} when status in 200..299 ->
        decode_body(body)

      {:ok, %{status: status}} when status in [401, 403] ->
        {:error, :token_expired}

      {:ok, %{status: status}} ->
        {:error, {:http_status, status}}

      {:error, reason} ->
        {:error, {:http_error, reason}}
    end
  end

  defp default_http(url, headers) do
    case Req.get(url, headers: headers, receive_timeout: @request_timeout_ms, retry: false) do
      {:ok, %Req.Response{status: status, body: body}} -> {:ok, %{status: status, body: body}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp decode_body(body) when is_map(body), do: {:ok, body}
  defp decode_body(body) when is_binary(body), do: decode_json(body)
  defp decode_body(_body), do: {:error, :invalid_usage_body}

  # ── Normalization ───────────────────────────────────────────────────────────

  defp build_windows(body) do
    [
      {:session, Map.get(body, "five_hour")},
      {:weekly, Map.get(body, "seven_day")},
      {:sonnet_weekly, Map.get(body, "seven_day_sonnet")}
    ]
    |> Enum.map(fn {kind, window} -> build_window(kind, window) end)
    |> Enum.reject(&is_nil/1)
  end

  defp build_window(kind, window) when is_map(window) do
    case clamped_percent(Map.get(window, "utilization")) do
      nil ->
        nil

      used_percent ->
        %Window{
          kind: kind,
          used_percent: used_percent,
          resets_at: to_integer(Map.get(window, "resets_at")),
          window_minutes: nil
        }
    end
  end

  defp build_window(_kind, _window), do: nil

  defp credits_remaining(body) do
    case Map.get(body, "extra_usage") do
      %{} = extra ->
        enabled = Map.get(extra, "is_enabled") == true
        limit = as_number(Map.get(extra, "monthly_limit"))
        spent = as_number(Map.get(extra, "used_credits")) || 0

        if enabled and is_number(limit), do: limit - spent, else: nil

      _ ->
        nil
    end
  end

  defp clamped_percent(value) when is_number(value), do: value |> max(0) |> min(100) |> :erlang.float()
  defp clamped_percent(_value), do: nil

  # ── Credentials parsing ─────────────────────────────────────────────────────

  defp ensure_token_live(%{expires_at: nil}, _now_ms), do: :ok

  defp ensure_token_live(%{expires_at: expires_at}, now_ms) when is_integer(expires_at) do
    if expires_at > now_ms, do: :ok, else: {:error, :token_expired}
  end

  defp read_file(path) do
    case File.read(path) do
      {:ok, raw} -> {:ok, raw}
      {:error, :enoent} -> {:error, :no_credentials}
      {:error, reason} -> {:error, {:read_error, reason}}
    end
  end

  defp decode_json(raw) do
    case Jason.decode(raw) do
      {:ok, json} -> {:ok, json}
      {:error, _} -> {:error, :invalid_credentials}
    end
  end

  defp fetch_oauth(%{"claudeAiOauth" => %{} = oauth}), do: {:ok, oauth}
  defp fetch_oauth(_json), do: {:error, :no_oauth}

  defp fetch_access_token(oauth) do
    case Map.get(oauth, "accessToken") do
      token when is_binary(token) and token != "" -> {:ok, token}
      _ -> {:error, :no_access_token}
    end
  end

  defp credentials_path(opts), do: Keyword.get(opts, :credentials_path, default_credentials_path())

  # ── Coercion helpers ────────────────────────────────────────────────────────

  defp as_number(value) when is_number(value), do: value
  defp as_number(_value), do: nil

  defp to_integer(value) when is_integer(value), do: value
  defp to_integer(value) when is_float(value), do: trunc(value)
  defp to_integer(_value), do: nil

  defp blank_to_nil(value) when is_binary(value) and value != "", do: value
  defp blank_to_nil(_value), do: nil
end
