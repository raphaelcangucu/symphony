defmodule SymphonyElixir.Claude.ApprovalBroker do
  @moduledoc """
  Correlates a Claude interactive tool-approval request with the operator's
  decision.

  Claude's headless (`--print`) runs cannot answer a mid-stream approval prompt
  the way the Codex app-server can. Interactive `build` runs instead give Claude
  an MCP `--permission-prompt-tool`; when Claude calls it, the MCP handler process
  blocks in `await/2` until the assistant channel calls `resolve/2` with the
  operator's decision. Claude receives the returned `allow`/`deny` and continues.

  Backed by a `Registry` keyed on the opaque `request_id`. The waiting MCP handler
  process registers itself under that id; `resolve/2` dispatches the decision to
  it. Both calls are safe when no counterpart exists (a stale or duplicate
  decision is dropped, and a never-answered request falls back to `:deny` on
  timeout so a turn can never hang forever).
  """

  require Logger

  @registry __MODULE__.Registry

  @type decision :: :approve | :deny

  @doc "Child spec for the backing registry; added to the shared (always-on) supervisor."
  @spec registry_child_spec() :: {module(), keyword()}
  def registry_child_spec, do: {Registry, keys: :unique, name: @registry}

  @doc """
  Block the calling process until a decision for `request_id` arrives or
  `timeout_ms` elapses.

  Returns `:approve` or `:deny`. A timeout resolves to `:deny` so a slow or absent
  operator degrades to denial rather than hanging the agent turn. Meant to be
  called from the MCP permission-prompt-tool handler process.
  """
  @spec await(String.t(), non_neg_integer()) :: decision()
  def await(request_id, timeout_ms)
      when is_binary(request_id) and is_integer(timeout_ms) and timeout_ms >= 0 do
    await(request_id, timeout_ms, fn -> :ok end)
  end

  @doc """
  Registers the waiter before publishing the request through `on_registered`.

  Use this form when the caller exposes the request ID to another process. It
  closes the race where a fast decision could otherwise arrive before the
  waiting process was registered.
  """
  @spec await(String.t(), non_neg_integer(), (-> term())) :: decision()
  def await(request_id, timeout_ms, on_registered)
      when is_binary(request_id) and is_integer(timeout_ms) and timeout_ms >= 0 and
             is_function(on_registered, 0) do
    ensure_registry()

    case Registry.register(@registry, request_id, nil) do
      {:ok, _owner} ->
        _ = on_registered.()

        receive do
          {:approval_decision, ^request_id, decision} when decision in [:approve, :deny] ->
            decision
        after
          timeout_ms ->
            Logger.warning("[Claude.ApprovalBroker] approval #{short(request_id)} timed out after #{timeout_ms}ms; denying")
            :deny
        end

      {:error, {:already_registered, _pid}} ->
        # A random request_id should never collide; treat a duplicate as a denial
        # rather than silently overwriting the earlier waiter.
        Logger.warning("[Claude.ApprovalBroker] duplicate approval request_id #{short(request_id)}; denying")
        :deny
    end
  end

  @doc """
  Deliver `decision` to the process awaiting `request_id`. No-op when nobody is
  waiting (e.g. a duplicate submit or a decision that raced the turn ending).
  """
  @spec resolve(String.t(), decision()) :: :ok
  def resolve(request_id, decision)
      when is_binary(request_id) and decision in [:approve, :deny] do
    ensure_registry()

    Registry.dispatch(@registry, request_id, fn entries ->
      Enum.each(entries, fn {pid, _value} ->
        send(pid, {:approval_decision, request_id, decision})
      end)
    end)

    :ok
  end

  # The registry is normally started by SharedSupervisor. Start it defensively so
  # the broker also works in isolated unit tests / escript contexts, mirroring the
  # lazy-start approach used by the ToolGateway.
  defp ensure_registry do
    if Process.whereis(@registry) == nil do
      case Registry.start_link(keys: :unique, name: @registry) do
        {:ok, _pid} -> :ok
        {:error, {:already_started, _pid}} -> :ok
        {:error, reason} -> Logger.warning("[Claude.ApprovalBroker] registry start failed: #{inspect(reason)}")
      end
    end

    :ok
  end

  defp short(id) when is_binary(id), do: String.slice(id, 0, 8)
end
