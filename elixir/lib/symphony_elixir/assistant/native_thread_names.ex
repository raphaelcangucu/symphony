defmodule SymphonyElixir.Assistant.NativeThreadNames do
  @moduledoc """
  Best-effort synchronization from Symphony session titles to native Codex
  thread names.

  Symphony remains the source of truth. Native naming failures are logged and
  never roll back a persisted session title; the next Codex turn also retries
  the canonical title through its normal start/resume options.
  """

  require Logger

  alias SymphonyElixir.Assistant.{History, Thread}
  alias SymphonyElixir.Codex.CodingAgent

  @type setter :: (Path.t(), String.t(), String.t(), keyword() -> :ok | {:error, term()})

  @spec sync(Thread.t(), keyword()) :: Thread.t()
  def sync(%Thread{} = thread, opts \\ []) when is_list(opts) do
    with {:ok, workspace, thread_id, title} <- sync_context(thread) do
      setter =
        Keyword.get(opts, :setter) ||
          Application.get_env(:symphony_elixir, :native_thread_name_setter) ||
          (&CodingAgent.set_thread_name/4)

      coding_agent_opts = Keyword.get(opts, :coding_agent_opts, [])

      case setter.(workspace, thread_id, title, coding_agent_opts) do
        :ok ->
          thread

        {:error, reason} ->
          Logger.warning("Codex native thread name sync failed thread_id=#{thread_id}: #{inspect(reason)}")

          thread
      end
    else
      :skip -> thread
    end
  end

  defp sync_context(%Thread{} = thread) do
    workspace = nonblank(thread.workspace_path)
    thread_id = nonblank(History.agent_thread_id(thread, "codex")) || nonblank(thread.codex_thread_id)
    title = nonblank(thread.title)

    if workspace && thread_id && title do
      {:ok, workspace, thread_id, title}
    else
      :skip
    end
  end

  defp nonblank(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp nonblank(_value), do: nil
end
