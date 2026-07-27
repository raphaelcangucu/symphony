defmodule SymphonyElixir.MobileComparison.Service do
  @moduledoc """
  Reconciles and starts the canonical Dev10x comparison on one selected host.

  Every durable operation is delegated to the existing Symphony gateway. The
  coordinator only owns the fixed cell contract, ordering, and aggregate view.
  """

  alias SymphonyElixir.MobileComparison.{Contract, LocalGateway, Presenter}

  @retryable_statuses ~w(failed blocked error cancelled canceled)

  @type result :: {:ok, map()} | {:error, term()}

  @spec start(map(), map()) :: result()
  def start(
        %{
          "project_slug" => project_slug,
          "identifier" => identifier,
          "request_key" => request_key
        },
        context
      )
      when is_binary(project_slug) and is_binary(identifier) and
             is_binary(request_key) and request_key != "" and is_map(context) do
    request_context = Map.put(context, :comparison_request_key, request_key)
    gateway = Map.get(request_context, :comparison_gateway, LocalGateway)

    with {:ok, parent} <- gateway.get_parent(project_slug, identifier, request_context),
         {:ok, existing_children} <-
           gateway.list_children(project_slug, identifier, request_context),
         {:ok, cells} <-
           reconcile_cells(
             gateway,
             project_slug,
             identifier,
             parent,
             existing_children,
             request_context
           ) do
      {:ok, Presenter.snapshot(parent, cells)}
    end
  end

  def start(_params, _context), do: {:error, :invalid_params}

  @spec get(map(), map()) :: result()
  def get(
        %{"project_slug" => project_slug, "identifier" => identifier},
        context
      )
      when is_binary(project_slug) and is_binary(identifier) and is_map(context) do
    gateway = Map.get(context, :comparison_gateway, LocalGateway)

    with {:ok, parent} <- gateway.get_parent(project_slug, identifier, context),
         {:ok, children} <- gateway.list_children(project_slug, identifier, context),
         {:ok, executions} <- gateway.list_executions(context),
         {:ok, cells} <-
           present_existing_cells(
             gateway,
             project_slug,
             children,
             executions,
             context
           ) do
      {:ok, Presenter.snapshot(parent, cells)}
    end
  end

  def get(_params, _context), do: {:error, :invalid_params}

  @spec retry_cell(map(), map()) :: result()
  def retry_cell(
        %{
          "project_slug" => project_slug,
          "identifier" => identifier,
          "request_key" => request_key,
          "cell_id" => cell_id
        },
        context
      )
      when is_binary(project_slug) and is_binary(identifier) and
             is_binary(request_key) and request_key != "" and is_binary(cell_id) and
             is_map(context) do
    request_context = Map.put(context, :comparison_request_key, request_key)
    gateway = Map.get(request_context, :comparison_gateway, LocalGateway)

    with {:ok, contract} <- Contract.fetch(cell_id),
         {:ok, snapshot} <-
           get(
             %{"project_slug" => project_slug, "identifier" => identifier},
             request_context
           ),
         {:ok, presented_cell} <- fetch_presented_cell(snapshot, cell_id),
         :ok <- ensure_retryable(presented_cell),
         {:ok, parent} <- gateway.get_parent(project_slug, identifier, request_context),
         {:ok, children} <- gateway.list_children(project_slug, identifier, request_context),
         {:ok, child} <- fetch_child(children, cell_id),
         :ok <-
           retry(
             gateway,
             project_slug,
             child,
             contract,
             prompt(parent),
             request_context
           ) do
      get(
        %{"project_slug" => project_slug, "identifier" => identifier},
        request_context
      )
    end
  end

  def retry_cell(_params, _context), do: {:error, :invalid_params}

  defp reconcile_cells(
         gateway,
         project_slug,
         parent_identifier,
         parent,
         existing_children,
         context
       ) do
    prompt = prompt(parent)

    Contract.cells()
    |> Enum.reduce_while({:ok, []}, fn contract, {:ok, cells} ->
      with {:ok, child} <-
             ensure_child(
               gateway,
               project_slug,
               parent_identifier,
               contract,
               prompt,
               existing_children,
               context
             ),
           {:ok, cell} <-
             start_and_present(gateway, project_slug, child, contract, prompt, context) do
        {:cont, {:ok, cells ++ [cell]}}
      else
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp ensure_child(
         gateway,
         project_slug,
         parent_identifier,
         contract,
         prompt,
         existing_children,
         context
       ) do
    case Enum.find(existing_children, &(value(&1, :comparison_cell_id) == contract.id)) do
      nil -> gateway.create_child(project_slug, parent_identifier, contract, prompt, context)
      child -> {:ok, child}
    end
  end

  defp start_and_present(
         gateway,
         project_slug,
         child,
         %{path: :session} = contract,
         prompt,
         context
       ) do
    with {:ok, thread} <- gateway.ensure_session(project_slug, child, contract, context),
         {:ok, active_thread} <- ensure_session_started(gateway, thread, prompt, context),
         {:ok, previews} <- gateway.list_previews(active_thread, context),
         {:ok, evidence} <-
           gateway.list_evidence(project_slug, value(child, :identifier), context) do
      {:ok, Presenter.cell(contract, child, active_thread, nil, previews, evidence)}
    end
  end

  defp start_and_present(
         gateway,
         project_slug,
         child,
         %{path: :orchestrator} = contract,
         _prompt,
         context
       ) do
    with {:ok, executions} <- gateway.list_executions(context),
         {:ok, execution} <-
           ensure_orchestrator_started(
             gateway,
             project_slug,
             child,
             executions,
             context
           ),
         {:ok, evidence} <-
           gateway.list_evidence(project_slug, value(child, :identifier), context) do
      {:ok, Presenter.cell(contract, child, nil, execution, [], evidence)}
    end
  end

  defp ensure_session_started(gateway, thread, prompt, context) do
    if value(thread, :status) in ["ready", "created", "idle"] do
      with :ok <- gateway.start_session(thread, prompt, context) do
        {:ok, put_value(thread, :status, "active")}
      end
    else
      {:ok, thread}
    end
  end

  defp ensure_orchestrator_started(gateway, project_slug, child, executions, context) do
    identifier = value(child, :identifier)

    case find_execution(executions, identifier) do
      nil ->
        with :ok <- gateway.dispatch_child(project_slug, child, context),
             {:ok, refreshed} <- gateway.list_executions(context) do
          {:ok, find_execution(refreshed, identifier)}
        end

      execution ->
        {:ok, execution}
    end
  end

  defp find_execution(executions, identifier),
    do: Enum.find(executions, &(value(&1, :issue_identifier) == identifier))

  defp present_existing_cells(gateway, project_slug, children, executions, context) do
    Contract.cells()
    |> Enum.reduce_while({:ok, []}, fn contract, {:ok, cells} ->
      case present_existing_cell(
             gateway,
             project_slug,
             contract,
             children,
             executions,
             context
           ) do
        {:ok, cell} -> {:cont, {:ok, cells ++ [cell]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp present_existing_cell(
         gateway,
         project_slug,
         contract,
         children,
         executions,
         context
       ) do
    child =
      Enum.find(children, &(value(&1, :comparison_cell_id) == contract.id)) ||
        %{"identifier" => nil}

    with {:ok, thread} <- existing_thread(gateway, project_slug, child, contract, context),
         {:ok, previews} <- existing_previews(gateway, thread, context),
         {:ok, evidence} <- existing_evidence(gateway, project_slug, child, context) do
      execution = find_execution(executions, value(child, :identifier))
      {:ok, Presenter.cell(contract, child, thread, execution, previews, evidence)}
    end
  end

  defp existing_thread(_gateway, _project_slug, _child, %{path: :orchestrator}, _context),
    do: {:ok, nil}

  defp existing_thread(gateway, project_slug, child, %{path: :session} = contract, context) do
    if is_binary(value(child, :identifier)) do
      case gateway.get_session(project_slug, child, contract, context) do
        {:ok, thread} -> {:ok, thread}
        {:error, :not_found} -> {:ok, nil}
        {:error, reason} -> {:error, reason}
      end
    else
      {:ok, nil}
    end
  end

  defp existing_previews(_gateway, nil, _context), do: {:ok, []}
  defp existing_previews(gateway, thread, context), do: gateway.list_previews(thread, context)

  defp existing_evidence(_gateway, _project_slug, %{"identifier" => nil}, _context),
    do: {:ok, []}

  defp existing_evidence(gateway, project_slug, child, context),
    do: gateway.list_evidence(project_slug, value(child, :identifier), context)

  defp fetch_presented_cell(%{"cells" => cells}, cell_id) when is_list(cells) do
    case Enum.find(cells, &(value(&1, :id) == cell_id)) do
      nil -> {:error, :comparison_cell_not_found}
      cell -> {:ok, cell}
    end
  end

  defp fetch_presented_cell(_snapshot, _cell_id), do: {:error, :comparison_cell_not_found}

  defp fetch_child(children, cell_id) do
    case Enum.find(children, &(value(&1, :comparison_cell_id) == cell_id)) do
      nil -> {:error, :comparison_cell_not_found}
      child -> {:ok, child}
    end
  end

  defp ensure_retryable(cell) do
    if value(cell, :status) in @retryable_statuses do
      :ok
    else
      {:error, :cell_not_retryable}
    end
  end

  defp retry(gateway, project_slug, child, %{path: :session} = contract, prompt, context),
    do: gateway.retry_session(project_slug, child, contract, prompt, context)

  defp retry(gateway, project_slug, child, %{path: :orchestrator}, _prompt, context),
    do: gateway.retry_child(project_slug, child, context)

  defp prompt(parent) do
    case value(parent, :description) do
      description when is_binary(description) and description != "" -> description
      _other -> value(parent, :title) || ""
    end
  end

  defp value(map, key), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))

  defp put_value(map, key, value) do
    if Map.has_key?(map, key) do
      Map.put(map, key, value)
    else
      Map.put(map, Atom.to_string(key), value)
    end
  end
end
