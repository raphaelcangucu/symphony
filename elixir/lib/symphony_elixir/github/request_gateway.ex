defmodule SymphonyElixir.GitHub.RequestGateway do
  @moduledoc """
  Coordinates GitHub HTTP traffic so Symphony follows GitHub's REST/GraphQL
  guidance without blocking interactive request paths:

  - **Fail fast while rate limited** — when a response signals a primary or
    secondary rate limit, the gateway records a shared `blocked_until` window
    derived from `Retry-After` / `x-ratelimit-reset`. Subsequent requests issued
    while the window is open return a synthetic `429` *immediately* instead of
    sleeping, so HTTP handlers, the orchestrator poll, and app boot are never
    frozen waiting for the reset. Callers classify the synthetic response with
    the same `{:rate_limited, _}` rules used for real responses.
  - **Pause between mutative requests** — mutations are spaced at least
    `mutation_interval_ms` apart (bounded by `max_wait_ms`) so writes are not
    fired in bursts. Reads run concurrently; spacing reads provides no relief for
    the hourly GraphQL points budget and only adds latency to the UI.
  - **Stop hammering when blocked** — once `blocked_until` is set, no further
    GitHub calls are made until the window elapses, so a rate-limited account is
    given room to recover. The window is capped at `max_block_ms` so a far-future
    reset header cannot wedge the app for an hour; the gateway re-probes instead.

  The GenServer never sleeps: `reserve/2` only checks the shared schedule and
  returns either `{:proceed, wait_ms}` (a short, bounded spacing wait the caller
  performs) or `{:blocked, reset_at}`. This keeps `GenServer.call/3` fast.

  If the gateway process is not running (for example in unit tests that exercise
  callers in isolation), `run/2` degrades to invoking the request function
  directly without throttling.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.GitHub.RateLimit

  @call_timeout 5_000
  @default_mutation_interval_ms 1_000
  @default_max_wait_ms 2_000
  @default_min_block_ms 1_000
  @default_max_block_ms 60_000

  @type kind :: :read | :mutation
  @type request_result :: {:ok, term()} | {:error, term()}

  @type tuning :: %{
          mutation_interval_ms: non_neg_integer(),
          max_wait_ms: non_neg_integer(),
          min_block_ms: non_neg_integer(),
          max_block_ms: non_neg_integer()
        }

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @doc """
  Runs `fun` (a GitHub HTTP request returning `{:ok, response} | {:error, reason}`)
  under the gateway.

  Options:

  - `:kind` — `:read` (default) or `:mutation`; controls inter-request spacing.
  - `:gateway` — the registered name or pid to use (defaults to this module).
  - `:sleep_fun` — 1-arity sleeper, injected in tests (defaults to `Process.sleep/1`).

  Returns the request function's result. While a shared rate-limit window is
  open, returns a synthetic `{:ok, %{status: 429, ...}}` response *without*
  calling `fun`, so callers surface `{:rate_limited, _}` quickly instead of
  blocking. A real rate-limited response opens the shared window for later
  callers.
  """
  @spec run(keyword(), (-> request_result())) :: request_result()
  def run(opts, fun) when is_list(opts) and is_function(fun, 0) do
    gateway = Keyword.get(opts, :gateway, __MODULE__)

    if alive?(gateway) do
      kind = normalize_kind(Keyword.get(opts, :kind, :read))
      sleep_fun = Keyword.get(opts, :sleep_fun, &Process.sleep/1)
      execute(gateway, kind, fun, sleep_fun)
    else
      fun.()
    end
  end

  @doc """
  Reserves the next slot for `kind`.

  Returns `{:blocked, reset_at}` when a shared rate-limit window is open, or
  `{:proceed, wait_ms}` with the (bounded) spacing the caller should wait before
  issuing the request.
  """
  @spec reserve(GenServer.server(), kind()) ::
          {:blocked, DateTime.t() | nil} | {:proceed, non_neg_integer()}
  def reserve(gateway, kind) do
    GenServer.call(gateway, {:reserve, normalize_kind(kind)}, @call_timeout)
  end

  @doc """
  Records that the most recent request was rate limited so later callers fail
  fast until the shared window (derived from `reset_info`) elapses.
  """
  @spec report_rate_limited(GenServer.server(), %{optional(:reset_at) => DateTime.t() | nil}) ::
          :ok
  def report_rate_limited(gateway, %{} = reset_info) do
    GenServer.call(gateway, {:report_rate_limited, reset_info}, @call_timeout)
  end

  @impl true
  def init(opts) do
    clock = Keyword.get(opts, :clock, &__MODULE__.monotonic_ms/0)
    now_fun = Keyword.get(opts, :now_fun, &DateTime.utc_now/0)
    now = clock.()

    state = %{
      next_slot: now,
      blocked_until: now,
      blocked_reset_at: nil,
      clock: clock,
      now_fun: now_fun,
      tuning: resolve_tuning(opts)
    }

    {:ok, state}
  end

  @impl true
  def handle_call({:reserve, kind}, _from, state) do
    now = state.clock.()

    cond do
      now < state.blocked_until ->
        {:reply, {:blocked, state.blocked_reset_at}, state}

      kind == :mutation ->
        start_at = max(now, state.next_slot)
        wait_ms = min(start_at - now, state.tuning.max_wait_ms)
        {:reply, {:proceed, wait_ms}, %{state | next_slot: start_at + state.tuning.mutation_interval_ms}}

      true ->
        {:reply, {:proceed, 0}, state}
    end
  end

  @impl true
  def handle_call({:report_rate_limited, reset_info}, _from, state) do
    now = state.clock.()
    reset_at = Map.get(reset_info, :reset_at)
    delay_ms = block_delay_ms(reset_at, state)
    blocked_until = max(state.blocked_until, now + delay_ms)

    {:reply, :ok, %{state | blocked_until: blocked_until, blocked_reset_at: reset_at}}
  end

  @doc false
  @spec monotonic_ms() :: integer()
  def monotonic_ms, do: System.monotonic_time(:millisecond)

  defp execute(gateway, kind, fun, sleep_fun) do
    case reserve(gateway, kind) do
      {:blocked, reset_at} ->
        {:ok, blocked_response(reset_at)}

      {:proceed, wait_ms} ->
        if wait_ms > 0, do: sleep_fun.(wait_ms)
        result = fun.()
        maybe_report_rate_limit(gateway, result)
        result
    end
  end

  defp maybe_report_rate_limit(gateway, {:ok, response}) do
    if RateLimit.rate_limited?(response) do
      reset_info = RateLimit.reset_info(response)
      Logger.warning("GitHub rate limit hit; pausing new requests until #{format_reset(reset_info)}")
      :ok = report_rate_limited(gateway, reset_info)
    end

    :ok
  end

  defp maybe_report_rate_limit(_gateway, _result), do: :ok

  # Synthetic response so callers classify a blocked request with the same
  # `{:rate_limited, _}` path as a real 429, carrying the reset hint for the UI.
  defp blocked_response(%DateTime{} = reset_at) do
    %{status: 429, headers: [{"x-ratelimit-reset", Integer.to_string(DateTime.to_unix(reset_at))}], body: %{}}
  end

  defp blocked_response(_reset_at) do
    %{status: 429, headers: [], body: %{}}
  end

  defp block_delay_ms(%DateTime{} = reset_at, state) do
    diff = DateTime.diff(reset_at, state.now_fun.(), :millisecond)

    diff
    |> max(state.tuning.min_block_ms)
    |> min(state.tuning.max_block_ms)
  end

  defp block_delay_ms(_reset_at, state) do
    min(state.tuning.min_block_ms, state.tuning.max_block_ms)
  end

  defp format_reset(%{reset_at: %DateTime{} = reset_at}), do: DateTime.to_iso8601(reset_at)
  defp format_reset(_reset_info), do: "the reset window elapses"

  defp normalize_kind(:mutation), do: :mutation
  defp normalize_kind(_kind), do: :read

  defp resolve_tuning(opts) do
    %{
      mutation_interval_ms: interval(opts, :mutation_interval_ms, @default_mutation_interval_ms),
      max_wait_ms: interval(opts, :max_wait_ms, @default_max_wait_ms),
      min_block_ms: interval(opts, :min_block_ms, @default_min_block_ms),
      max_block_ms: max(interval(opts, :max_block_ms, @default_max_block_ms), 1)
    }
  end

  defp interval(opts, key, default) do
    case Keyword.get(opts, key) do
      value when is_integer(value) and value >= 0 -> value
      _ -> safe_config(key, default)
    end
  end

  defp safe_config(key, default) do
    case config_value(key) do
      value when is_integer(value) and value >= 0 -> value
      _ -> default
    end
  rescue
    _ -> default
  catch
    _, _ -> default
  end

  defp config_value(:mutation_interval_ms), do: Config.github_mutation_interval_ms()
  defp config_value(:max_block_ms), do: Config.github_max_backoff_ms()
  defp config_value(_key), do: nil

  defp alive?(name) when is_atom(name), do: is_pid(Process.whereis(name))
  defp alive?(pid) when is_pid(pid), do: Process.alive?(pid)
  defp alive?(_other), do: false
end
