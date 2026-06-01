defmodule SymphonyElixir.GitHub.RequestGateway do
  @moduledoc """
  Serializes every GitHub HTTP request through a single process so Symphony
  follows GitHub's REST/GraphQL best practices:

  - **Avoid concurrent requests** — callers acquire a slot on a shared monotonic
    schedule, so requests issued from the orchestrator poll, the dev-server
    reconciler, per-agent turns, and the assistant chat are staggered instead of
    fired in parallel.
  - **Pause between mutative requests** — mutations are spaced at least
    `mutation_interval_ms` (>= 1s) apart; reads use a smaller `read_interval_ms`.
  - **Handle rate-limit errors appropriately** — when a response is rate limited,
    the gateway records a shared `blocked_until` derived from `Retry-After` /
    `x-ratelimit-reset` (falling back to exponential backoff) and retries up to
    `max_retries`, so we stop hammering GitHub instead of risking a ban.

  The GenServer itself never sleeps: `acquire/1` only reserves the next slot and
  returns how long the caller should wait. The caller performs the sleep and the
  actual HTTP, then reports rate-limit outcomes back via `report_rate_limited/2`.
  This keeps `GenServer.call/3` fast (no long blocking calls) while still
  serializing all GitHub traffic globally.

  If the gateway process is not running (for example in unit tests that exercise
  callers in isolation), `run/2` degrades to invoking the request function
  directly without throttling.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.GitHub.RateLimit

  @call_timeout 5_000
  @default_read_interval_ms 150
  @default_mutation_interval_ms 1_000
  @default_max_retries 4
  @default_base_backoff_ms 1_000
  @default_max_backoff_ms 60_000

  @type kind :: :read | :mutation
  @type request_result :: {:ok, term()} | {:error, term()}

  @type tuning :: %{
          read_interval_ms: non_neg_integer(),
          mutation_interval_ms: non_neg_integer(),
          max_retries: pos_integer(),
          base_backoff_ms: non_neg_integer(),
          max_backoff_ms: non_neg_integer()
        }

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @doc """
  Runs `fun` (a GitHub HTTP request returning `{:ok, response} | {:error, reason}`)
  under the serialized gateway.

  Options:

  - `:kind` — `:read` (default) or `:mutation`; controls inter-request spacing.
  - `:gateway` — the registered name or pid to use (defaults to this module).
  - `:max_retries` — override the configured retry count.
  - `:sleep_fun` — 1-arity sleeper, injected in tests (defaults to `Process.sleep/1`).

  Returns the request function's result. When all retries are exhausted, the last
  (rate-limited) response is returned so the caller can classify it as
  `{:rate_limited, _}` as usual.
  """
  @spec run(keyword(), (-> request_result())) :: request_result()
  def run(opts, fun) when is_list(opts) and is_function(fun, 0) do
    gateway = Keyword.get(opts, :gateway, __MODULE__)

    if alive?(gateway) do
      kind = normalize_kind(Keyword.get(opts, :kind, :read))
      sleep_fun = Keyword.get(opts, :sleep_fun, &Process.sleep/1)
      attempt(gateway, kind, opts, fun, sleep_fun, 1)
    else
      fun.()
    end
  end

  @doc """
  Reserves the next request slot for `kind` and returns `{wait_ms, tuning}`.

  `wait_ms` is how long the caller must wait before issuing the request so that
  spacing and any active backoff window are respected.
  """
  @spec acquire(GenServer.server(), kind()) :: {non_neg_integer(), tuning()}
  def acquire(gateway, kind) do
    GenServer.call(gateway, {:acquire, normalize_kind(kind)}, @call_timeout)
  end

  @doc """
  Records that the most recent request was rate limited and the shared schedule
  must pause for at least `delay_ms` before any further GitHub request.
  """
  @spec report_rate_limited(GenServer.server(), non_neg_integer()) :: :ok
  def report_rate_limited(gateway, delay_ms) when is_integer(delay_ms) and delay_ms >= 0 do
    GenServer.call(gateway, {:report_rate_limited, delay_ms}, @call_timeout)
  end

  @impl true
  def init(opts) do
    clock = Keyword.get(opts, :clock, &__MODULE__.monotonic_ms/0)
    now = clock.()

    state = %{
      next_slot: now,
      blocked_until: now,
      clock: clock,
      tuning: resolve_tuning(opts)
    }

    {:ok, state}
  end

  @impl true
  def handle_call({:acquire, kind}, _from, state) do
    now = state.clock.()
    spacing = spacing_for(kind, state.tuning)
    start_at = Enum.max([now, state.next_slot, state.blocked_until])
    wait_ms = max(start_at - now, 0)

    {:reply, {wait_ms, state.tuning}, %{state | next_slot: start_at + spacing}}
  end

  @impl true
  def handle_call({:report_rate_limited, delay_ms}, _from, state) do
    now = state.clock.()
    blocked_until = max(state.blocked_until, now + delay_ms)
    next_slot = max(state.next_slot, blocked_until)

    {:reply, :ok, %{state | blocked_until: blocked_until, next_slot: next_slot}}
  end

  @doc false
  @spec monotonic_ms() :: integer()
  def monotonic_ms, do: System.monotonic_time(:millisecond)

  defp attempt(gateway, kind, opts, fun, sleep_fun, attempt_no) do
    {wait_ms, tuning} = acquire(gateway, kind)
    if wait_ms > 0, do: sleep_fun.(wait_ms)

    result = fun.()
    max_retries = Keyword.get(opts, :max_retries, tuning.max_retries)

    case result do
      {:ok, response} ->
        if RateLimit.rate_limited?(response) and attempt_no < max_retries do
          backoff(gateway, response, attempt_no, max_retries, tuning)
          attempt(gateway, kind, opts, fun, sleep_fun, attempt_no + 1)
        else
          result
        end

      {:error, _reason} ->
        result
    end
  end

  defp backoff(gateway, response, attempt_no, max_retries, tuning) do
    delay_ms =
      RateLimit.retry_delay_ms(response, attempt_no,
        base_backoff_ms: tuning.base_backoff_ms,
        max_backoff_ms: tuning.max_backoff_ms
      )

    Logger.warning(
      "GitHub rate limit hit; pausing #{delay_ms}ms before retry " <>
        "(attempt #{attempt_no}/#{max_retries})"
    )

    :ok = report_rate_limited(gateway, delay_ms)
  end

  defp spacing_for(:mutation, tuning), do: tuning.mutation_interval_ms
  defp spacing_for(_read, tuning), do: tuning.read_interval_ms

  defp normalize_kind(:mutation), do: :mutation
  defp normalize_kind(_kind), do: :read

  defp resolve_tuning(opts) do
    %{
      read_interval_ms: interval(opts, :read_interval_ms, @default_read_interval_ms),
      mutation_interval_ms: interval(opts, :mutation_interval_ms, @default_mutation_interval_ms),
      max_retries: max(interval(opts, :max_retries, @default_max_retries), 1),
      base_backoff_ms: Keyword.get(opts, :base_backoff_ms, @default_base_backoff_ms),
      max_backoff_ms: interval(opts, :max_backoff_ms, @default_max_backoff_ms)
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

  defp config_value(:read_interval_ms), do: Config.github_read_interval_ms()
  defp config_value(:mutation_interval_ms), do: Config.github_mutation_interval_ms()
  defp config_value(:max_retries), do: Config.github_max_retries()
  defp config_value(:max_backoff_ms), do: Config.github_max_backoff_ms()

  defp alive?(name) when is_atom(name), do: is_pid(Process.whereis(name))
  defp alive?(pid) when is_pid(pid), do: Process.alive?(pid)
  defp alive?(_other), do: false
end
