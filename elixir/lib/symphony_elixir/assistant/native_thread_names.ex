defmodule SymphonyElixir.Assistant.NativeThreadNames do
  @moduledoc """
  Best-effort synchronization from Symphony session titles to native Codex
  thread names.

  Symphony remains the source of truth. Native naming failures are logged and
  never roll back a persisted session title; every completed Codex turn also
  retries the canonical title after persisting the returned native thread id.
  """

  require Logger

  alias SymphonyElixir.Assistant.{History, Thread}
  alias SymphonyElixir.Codex.CodingAgent

  @type setter :: (Path.t(), String.t(), String.t(), keyword() -> term())

  @spec sync(Thread.t(), keyword()) :: Thread.t()
  def sync(%Thread{} = thread, opts \\ []) when is_list(opts) do
    try do
      result =
        :global.trans({{__MODULE__, lock_id(thread)}, self()}, fn ->
          case reload_thread(thread, opts) do
            %Thread{} = current -> do_sync(current, opts)
            :skip -> :skip
          end
        end)

      case result do
        %Thread{} = current ->
          current

        :skip ->
          thread

        unexpected ->
          log_failure(native_thread_id(thread), {:lock_failed, unexpected})
          thread
      end
    catch
      kind, reason ->
        log_failure(native_thread_id(thread), {kind, reason})
        thread
    end
  end

  defp do_sync(thread, opts) do
    with {:ok, workspace, thread_id, title} <- sync_context(thread) do
      setter =
        Keyword.get(opts, :setter) ||
          Application.get_env(:symphony_elixir, :native_thread_name_setter) ||
          (&CodingAgent.set_thread_name/4)

      coding_agent_opts = Keyword.get(opts, :coding_agent_opts, [])

      try do
        case setter.(workspace, thread_id, title, coding_agent_opts) do
          :ok ->
            thread

          {:error, reason} ->
            log_failure(thread_id, reason)
            thread

          unexpected ->
            log_failure(thread_id, {:unexpected_result, unexpected})
            thread
        end
      catch
        kind, reason ->
          log_failure(thread_id, {kind, reason})
          thread
      end
    else
      :skip -> thread
    end
  end

  defp reload_thread(%Thread{id: id}, opts) when is_integer(id) and id > 0 do
    reloader = Keyword.get(opts, :reloader, &History.get_thread/1)

    case reloader.(id) do
      {:ok, %Thread{} = current} -> current
      _other -> :skip
    end
  end

  defp reload_thread(thread, _opts), do: thread

  defp sync_context(%Thread{} = thread) do
    workspace = nonblank(thread.workspace_path)
    thread_id = native_thread_id(thread)
    title = nonblank(thread.title)

    if codex_active?(thread) && workspace && thread_id && title do
      {:ok, workspace, thread_id, title}
    else
      :skip
    end
  end

  defp native_thread_id(%Thread{} = thread) do
    nonblank(History.agent_thread_id(thread, "codex")) || nonblank(thread.codex_thread_id)
  end

  defp codex_active?(%Thread{agent_kind: agent_kind}), do: agent_kind in [nil, "codex"]

  defp lock_id(%Thread{id: id}) when is_integer(id) and id > 0, do: id
  defp lock_id(%Thread{} = thread), do: native_thread_id(thread) || make_ref()

  defp log_failure(thread_id, reason) do
    Logger.warning("Codex native thread name sync failed thread_id=#{thread_id || "unknown"}: #{inspect(reason)}")
  end

  defp nonblank(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp nonblank(_value), do: nil
end
