defmodule SymphonyElixir.Assistant.DispatchTools do
  @moduledoc false

  alias SymphonyElixir.AgentRouting
  alias SymphonyElixir.Assistant.HandoffTools
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.Settings.Orchestration

  @tool "explain_dispatch_eligibility"

  @description """
  Explain whether the orchestrator would auto-dispatch an issue, listing concrete reasons when it would not.
  Use to answer "why didn't this issue start?". Checks status against dispatch/terminal/wait states and the symphony-label gate.
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" => String.trim(@description),
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier"],
        "properties" => %{
          "identifier" => %{"type" => "string", "description" => "Issue identifier, for example MAC-1."}
        }
      }
    }
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    with {:ok, identifier} <- required_identifier(arguments),
         {:ok, issue} <- Context.get_issue(project_slug, identifier),
         {:ok, config} <- HandoffTools.load_config(project_slug, opts) do
      require_label = Keyword.get(opts, :require_symphony_label, Orchestration.require_symphony_label?())
      require_assignee = Keyword.get(opts, :require_assignee_match, Orchestration.require_assignee_match?())
      dispatch_states = Keyword.get(opts, :dispatch_states, config.dispatch_states) || []

      status = status_name(issue)
      labels = label_names(issue)
      reasons = compute_reasons(status, labels, config, dispatch_states, require_label)

      {:ok,
       %{
         tool: @tool,
         message: eligibility_message(identifier, reasons),
         data: %{
           eligible: reasons == [],
           reasons: reasons,
           status: status,
           labels: labels,
           assignee_id: issue.assignee_id,
           gates: %{
             require_symphony_label: require_label,
             require_assignee_match: require_assignee,
             dispatch_states: dispatch_states
           }
         }
       }}
    end
  end

  defp compute_reasons(status, labels, %ProjectConfig{} = config, dispatch_states, require_label) do
    []
    |> add_unless(in_states?(status, dispatch_states), "status_not_in_dispatch_states")
    |> add_if(in_states?(status, config.terminal_states), "terminal_state")
    |> add_if(in_states?(status, config.wait_states), "wait_state")
    |> add_if(require_label and not Enum.any?(labels, &AgentRouting.symphony_label?/1), "missing_symphony_label")
    |> Enum.reverse()
  end

  defp add_if(reasons, true, reason), do: [reason | reasons]
  defp add_if(reasons, _false, _reason), do: reasons
  defp add_unless(reasons, true, _reason), do: reasons
  defp add_unless(reasons, _false, reason), do: [reason | reasons]

  defp in_states?(nil, _states), do: false
  defp in_states?(_status, states) when not is_list(states), do: false

  defp in_states?(status, states) do
    normalized = normalize(status)
    Enum.any?(states, &(normalize(&1) == normalized))
  end

  defp normalize(value) when is_binary(value), do: value |> String.trim() |> String.downcase()
  defp normalize(_value), do: ""

  defp status_name(%{status: %{name: name}}) when is_binary(name), do: name
  defp status_name(_issue), do: nil

  defp label_names(%{labels: labels}) when is_list(labels) do
    Enum.flat_map(labels, fn
      %{name: name} when is_binary(name) -> [name]
      name when is_binary(name) -> [name]
      _other -> []
    end)
  end

  defp label_names(_issue), do: []

  defp eligibility_message(identifier, []), do: "#{identifier} is eligible for auto-dispatch."

  defp eligibility_message(identifier, reasons),
    do: "#{identifier} is not eligible: #{Enum.join(reasons, ", ")}."

  defp required_identifier(arguments) do
    case Map.get(arguments, "identifier") do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, :missing_identifier}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_identifier}
    end
  end
end
