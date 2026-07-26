defmodule SymphonyElixir.MobileRpc.Dispatcher do
  @moduledoc "Bounded, allowlisted dispatcher for decrypted mobile RPC envelopes."

  alias SymphonyElixir.MobileRpc.{Envelope, Subscriptions}

  alias SymphonyElixir.MobileRpc.Methods.{
    Git,
    Notifications,
    Orchestrator,
    MobileFiles,
    MobileGit,
    MobileSessions,
    MobileSystem,
    MobileTasks,
    MobileWorkspaces,
    Previews,
    Projects,
    PullRequests,
    Sessions,
    System,
    Tasks,
    Terminal,
    Workspace
  }

  defstruct context: %{},
            methods: %{},
            in_flight: %{},
            seen_ids: MapSet.new(),
            max_concurrency: 8,
            task_supervisor: SymphonyElixir.TaskSupervisor,
            subscriptions: Subscriptions.new()

  @type t :: %__MODULE__{}

  @spec new(map(), keyword()) :: t()
  def new(context, opts \\ []) do
    modules =
      Keyword.get(
        opts,
        :methods,
        System.modules() ++
          MobileSystem.modules() ++
          MobileWorkspaces.modules() ++
          MobileSessions.modules() ++
          MobileFiles.modules() ++
          MobileGit.modules() ++
          MobileTasks.modules() ++
          Projects.modules() ++
          Tasks.modules() ++
          Sessions.modules() ++
          Workspace.modules() ++
          Git.modules() ++
          Previews.modules() ++
          PullRequests.modules() ++
          Notifications.modules() ++
          Orchestrator.modules() ++
          Terminal.modules()
      )

    methods = Map.new(modules, fn module -> {module.name(), module} end)
    capabilities = methods |> Map.keys() |> Enum.sort()

    %__MODULE__{
      context: Map.put(context, :capabilities, capabilities),
      methods: methods,
      max_concurrency: Keyword.get(opts, :max_concurrency, 8),
      task_supervisor: Keyword.get(opts, :task_supervisor, SymphonyElixir.TaskSupervisor)
    }
  end

  @spec handle_frame(binary(), t()) ::
          {:noreply, t()} | {:reply, binary(), t()} | {:error, binary(), t()}
  def handle_frame(raw, %__MODULE__{} = state) when is_binary(raw) do
    with {:ok, decoded} <- Jason.decode(raw),
         {:ok, envelope} <- Envelope.decode(decoded) do
      handle_envelope(envelope, state)
    else
      {:error, _reason} ->
        {:error, error_response("unknown", "invalid_envelope", "Invalid RPC envelope", false, state), state}
    end
  end

  @spec handle_info(term(), t()) ::
          {:reply, binary(), t()} | {:noreply, t()}
  def handle_info({ref, result}, %__MODULE__{} = state) when is_reference(ref) do
    case Map.get(state.in_flight, ref) do
      nil ->
        {:noreply, state}

      request ->
        Process.demonitor(ref, [:flush])
        cancel_timer(request.timer)
        next = drop_request(state, ref)
        complete_method(request.id, result, next)
    end
  end

  def handle_info({:rpc_timeout, ref}, %__MODULE__{} = state) do
    case Map.get(state.in_flight, ref) do
      nil ->
        {:noreply, state}

      request ->
        shutdown(request.task)
        next = drop_request(state, ref)

        {:reply,
         error_response(
           request.id,
           "deadline_exceeded",
           "RPC method deadline exceeded",
           true,
           next
         ), next}
    end
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, %__MODULE__{} = state) do
    case Map.get(state.in_flight, ref) do
      nil ->
        {:noreply, state}

      request ->
        cancel_timer(request.timer)
        next = drop_request(state, ref)

        {:reply,
         error_response(
           request.id,
           "method_failed",
           if(reason == :normal, do: "RPC method ended without a result", else: "RPC method failed"),
           false,
           next
         ), next}
    end
  end

  def handle_info(
        {:mobile_rpc_event, subscription_id, event, payload},
        %__MODULE__{} = state
      )
      when is_binary(subscription_id) and is_binary(event) do
    case Subscriptions.next_event(state.subscriptions, subscription_id) do
      {:ok, sequence, subscriptions} ->
        next = %{state | subscriptions: subscriptions}
        {:reply, Envelope.event(subscription_id, sequence, event, payload), next}

      {:error, :not_found} ->
        {:noreply, state}
    end
  end

  def handle_info(_message, state), do: {:noreply, state}

  @spec close(t()) :: :ok
  def close(%__MODULE__{} = state) do
    Enum.each(state.in_flight, fn {_ref, request} -> shutdown(request.task) end)
    Subscriptions.cleanup(state.subscriptions)
  end

  defp handle_envelope(%{type: :rpc} = request, state) do
    cond do
      MapSet.member?(state.seen_ids, request.id) ->
        {:error,
         error_response(
           request.id,
           "duplicate_request_id",
           "RPC request id was already used",
           false,
           state
         ), state}

      map_size(state.in_flight) >= state.max_concurrency ->
        {:error,
         error_response(
           request.id,
           "concurrency_limit",
           "Too many mobile RPC methods are running",
           true,
           state
         ), state}

      true ->
        dispatch_method(request, state)
    end
  end

  defp handle_envelope(%{type: :cancel, id: id}, state) do
    case Enum.find(state.in_flight, fn {_ref, request} -> request.id == id end) do
      nil ->
        {:error, error_response(id, "request_not_found", "RPC request is not running", false, state), state}

      {ref, request} ->
        shutdown(request.task)
        cancel_timer(request.timer)
        next = drop_request(state, ref)
        {:reply, error_response(id, "cancelled", "RPC request was cancelled", false, next), next}
    end
  end

  defp handle_envelope(%{type: :unsubscribe, subscription_id: id}, state) do
    case Subscriptions.remove(state.subscriptions, id) do
      {:ok, subscriptions} ->
        next = %{state | subscriptions: subscriptions}
        {:reply, Envelope.result(id, %{"unsubscribed" => true}, next.context), next}

      {:error, :not_found} ->
        {:error, error_response(id, "subscription_not_found", "RPC subscription was not found", false, state), state}
    end
  end

  defp handle_envelope(_envelope, state) do
    {:error, error_response("unknown", "invalid_envelope", "Invalid RPC envelope", false, state), state}
  end

  defp dispatch_method(request, state) do
    case Map.get(state.methods, request.method) do
      nil ->
        {:error,
         error_response(
           request.id,
           "method_not_allowed",
           "RPC method is not available to mobile",
           false,
           state
         ), state}

      method ->
        with :mobile <- method.scope(),
             {:ok, params} <- method.validate(request.params) do
          task = start_task(state.task_supervisor, fn -> method.call(params, state.context) end)
          timeout = min(request.deadline_ms || method.timeout_ms(), method.timeout_ms())
          timer = Process.send_after(self(), {:rpc_timeout, task.ref}, timeout)
          in_flight = Map.put(state.in_flight, task.ref, %{id: request.id, task: task, timer: timer})

          {:noreply,
           %{
             state
             | in_flight: in_flight,
               seen_ids: MapSet.put(state.seen_ids, request.id)
           }}
        else
          _reason ->
            {:error,
             error_response(
               request.id,
               "invalid_params",
               "RPC method parameters are invalid",
               false,
               state
             ), state}
        end
    end
  end

  defp start_task(supervisor, fun) do
    if Process.whereis(supervisor) do
      Task.Supervisor.async_nolink(supervisor, fun)
    else
      Task.async(fun)
    end
  end

  defp method_response(id, {:ok, result}, state), do: Envelope.result(id, result, state.context)

  defp method_response(
         id,
         {:error, {:tracker_request_failed, status, message}},
         state
       )
       when is_integer(status) and is_binary(message) do
    {code, retryable} = tracker_error(status)

    error_response(
      id,
      code,
      message,
      retryable,
      %{"status" => status},
      state
    )
  end

  defp method_response(
         id,
         {:error, {:rpc_error, code, message, retryable, data}},
         state
       )
       when is_binary(code) and is_binary(message) and is_boolean(retryable) do
    error_response(id, code, message, retryable, data, state)
  end

  defp method_response(id, {:error, _reason}, state) do
    error_response(id, "method_failed", "RPC method failed", false, state)
  end

  defp method_response(id, _unexpected, state) do
    error_response(id, "invalid_method_result", "RPC method returned an invalid result", false, state)
  end

  defp complete_method(
         id,
         {:ok, {:subscription, subscription_id, result, cleanup, activate}},
         state
       )
       when is_binary(subscription_id) and is_function(cleanup, 0) and
              is_function(activate, 0) do
    subscriptions = Subscriptions.put(state.subscriptions, subscription_id, cleanup)
    next = %{state | subscriptions: subscriptions}
    activate.()
    {:reply, Envelope.result(id, result, next.context), next}
  end

  defp complete_method(id, result, state),
    do: {:reply, method_response(id, result, state), state}

  defp error_response(id, code, message, retryable, state) do
    Envelope.error(id, code, message, retryable, state.context)
  end

  defp error_response(id, code, message, retryable, data, state) do
    Envelope.error(id, code, message, retryable, data, state.context)
  end

  defp tracker_error(status) when status in [400, 422], do: {"validation_failed", false}
  defp tracker_error(401), do: {"unauthenticated", false}
  defp tracker_error(403), do: {"forbidden", false}
  defp tracker_error(404), do: {"not_found", false}
  defp tracker_error(409), do: {"conflict", false}
  defp tracker_error(429), do: {"rate_limited", true}
  defp tracker_error(status) when status >= 500, do: {"tracker_unavailable", true}
  defp tracker_error(_status), do: {"tracker_request_failed", false}

  defp drop_request(state, ref), do: %{state | in_flight: Map.delete(state.in_flight, ref)}

  defp shutdown(task) do
    Task.shutdown(task, :brutal_kill)
    Process.demonitor(task.ref, [:flush])
    :ok
  end

  defp cancel_timer(nil), do: :ok

  defp cancel_timer(timer) do
    Process.cancel_timer(timer)
    :ok
  end
end
