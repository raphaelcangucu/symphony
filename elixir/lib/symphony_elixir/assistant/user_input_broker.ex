defmodule SymphonyElixir.Assistant.UserInputBroker do
  @moduledoc """
  Correlates a Claude AskUserQuestion PreToolUse wait with the operator's answers.

  Two stores:
  - Await `Registry` keyed by `request_id` for blocking waiters (hook HTTP handler).
  - ETS session table keyed by `session_token` → `%{channel_pid, thread_id, agent}`
    so the loopback HTTP façade can push `:assistant_user_input_required` into the
    live assistant channel.
  """

  require Logger

  @await_registry __MODULE__.AwaitRegistry
  @sessions __MODULE__.Sessions
  @default_timeout_ms 300_000

  @type answers :: %{optional(String.t()) => map()}
  @type session_binding :: %{
          required(:channel_pid) => pid(),
          required(:thread_id) => integer() | nil,
          required(:agent) => String.t()
        }

  @doc "Child spec for the await registry; add under SharedSupervisor."
  @spec registry_child_spec() :: {module(), keyword()}
  def registry_child_spec, do: {Registry, keys: :unique, name: @await_registry}

  @doc "Ensure registry + ETS exist (tests / defensive startup)."
  @spec ensure_started() :: :ok
  def ensure_started do
    ensure_registry()
    ensure_sessions_table()
    :ok
  end

  @doc """
  Block until `resolve/2` delivers answers for `request_id`, or `timeout_ms` elapses.
  """
  @spec await(String.t(), non_neg_integer()) :: {:ok, answers()} | {:error, :timeout | :duplicate}
  def await(request_id, timeout_ms \\ @default_timeout_ms)
      when is_binary(request_id) and is_integer(timeout_ms) and timeout_ms >= 0 do
    ensure_started()

    case Registry.register(@await_registry, request_id, nil) do
      {:ok, _owner} ->
        receive do
          {:user_input_answers, ^request_id, answers} when is_map(answers) ->
            {:ok, answers}
        after
          timeout_ms ->
            Logger.warning("[UserInputBroker] request #{short(request_id)} timed out after #{timeout_ms}ms")
            {:error, :timeout}
        end

      {:error, {:already_registered, _pid}} ->
        Logger.warning("[UserInputBroker] duplicate request_id #{short(request_id)}")
        {:error, :duplicate}
    end
  end

  @doc "Deliver answers to the waiter registered for `request_id` (no-op if nobody waits)."
  @spec resolve(String.t(), answers()) :: :ok
  def resolve(request_id, answers) when is_binary(request_id) and is_map(answers) do
    ensure_started()

    Registry.dispatch(@await_registry, request_id, fn entries ->
      Enum.each(entries, fn {pid, _value} ->
        send(pid, {:user_input_answers, request_id, answers})
      end)
    end)

    :ok
  end

  @doc "Bind a short-lived loopback session token to the live assistant channel."
  @spec bind_session(String.t(), session_binding()) :: :ok
  def bind_session(token, %{channel_pid: pid, agent: agent} = binding)
      when is_binary(token) and is_pid(pid) and is_binary(agent) do
    ensure_started()
    true = :ets.insert(@sessions, {token, Map.put_new(binding, :thread_id, nil)})
    :ok
  end

  @doc "Look up a previously bound session token."
  @spec lookup_session(String.t()) :: {:ok, session_binding()} | :error
  def lookup_session(token) when is_binary(token) do
    ensure_started()

    case :ets.lookup(@sessions, token) do
      [{^token, binding}] -> {:ok, binding}
      [] -> :error
    end
  end

  @doc "Drop a session token binding."
  @spec unbind_session(String.t()) :: :ok
  def unbind_session(token) when is_binary(token) do
    ensure_started()
    :ets.delete(@sessions, token)
    :ok
  end

  defp ensure_registry do
    if Process.whereis(@await_registry) == nil do
      case Registry.start_link(keys: :unique, name: @await_registry) do
        {:ok, _pid} ->
          :ok

        {:error, {:already_started, _pid}} ->
          :ok

        {:error, reason} ->
          Logger.warning("[UserInputBroker] registry start failed: #{inspect(reason)}")
      end
    end

    :ok
  end

  defp ensure_sessions_table do
    case :ets.whereis(@sessions) do
      :undefined ->
        :ets.new(@sessions, [:named_table, :public, :set, read_concurrency: true])
        :ok

      _tid ->
        :ok
    end
  end

  defp short(id) when is_binary(id), do: String.slice(id, 0, 8)
end
