defmodule SymphonyElixir.Assistant.DevEnvTools do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.DevEnv
  alias SymphonyElixir.LocalTracker.DevEnv.Runner
  alias SymphonyElixirWeb.DevEnvPresenter

  @tool "manage_dev_env"

  @assistant_actions ~w(list_steps propose_steps save_steps run run_step list_runs warm_up)a
  @coding_agent_actions ~w(list_steps run run_step list_runs)a

  @description """
  List, propose, save, or run project dev-environment setup/serve steps.
  Coding agents may only list or run existing steps (optionally filter category_filter=serve).
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    tool_spec(@description, action_input_schema(@assistant_actions, include_steps: true))
  end

  @spec issue_bound_tool_spec() :: map()
  def issue_bound_tool_spec do
    tool_spec(@description, action_input_schema(@coding_agent_actions, include_steps: false))
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec(), issue_bound_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    propose_steps = Keyword.get(opts, :propose_steps, &DevEnv.propose_steps/1)
    list_steps = Keyword.get(opts, :list_steps, &DevEnv.list_steps/1)
    save_steps = Keyword.get(opts, :save_steps, &DevEnv.save_steps/2)
    list_runs = Keyword.get(opts, :list_runs, &DevEnv.list_runs/1)
    start_run = Keyword.get(opts, :start_run, &DevEnv.start_run/1)
    finish_run = Keyword.get(opts, :finish_run, &DevEnv.finish_run/1)
    run_step = Keyword.get(opts, :run_step, &Runner.run_step/3)
    warm_up = Keyword.get(opts, :warm_up, &DevEnv.warm_up/2)

    with {:ok, action} <- normalize_action(Map.get(arguments, "action")),
         :ok <- authorize_action(action, opts) do
      if action == :warm_up do
        execute_warm_up(project_slug, warm_up)
      else
        execute_action(
          action,
          project_slug,
          arguments,
          propose_steps,
          list_steps,
          save_steps,
          list_runs,
          start_run,
          finish_run,
          run_step
        )
      end
    end
  end

  defp execute_warm_up(project_slug, warm_up) do
    case warm_up.(project_slug, []) do
      {:ok, data} ->
        {:ok, %{tool: @tool, message: warm_up_message(data), data: data}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp warm_up_message(%{status: "succeeded"}), do: "Dev environment warm-up succeeded."
  defp warm_up_message(%{failure_class: class}), do: "Warm-up failed (#{class}). See data for remediation."
  defp warm_up_message(_data), do: "Warm-up finished."

  defp execute_action(:list_steps, project_slug, _arguments, _propose, list_steps, _save, _runs, _start, _finish, _run_step) do
    steps = list_steps.(project_slug) |> Enum.map(&DevEnvPresenter.step/1)

    {:ok,
     %{
       tool: @tool,
       message: "Found #{length(steps)} dev-env step(s).",
       data: %{steps: steps}
     }}
  end

  defp execute_action(:propose_steps, project_slug, _arguments, propose_steps, _list, _save, _runs, _start, _finish, _run_step) do
    case propose_steps.(project_slug) do
      {:ok, proposals} ->
        presented = Enum.map(proposals, &DevEnvPresenter.proposed/1)

        {:ok,
         %{
           tool: @tool,
           message: "Proposed #{length(presented)} dev-env step(s).",
           data: %{proposals: presented}
         }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp execute_action(:save_steps, project_slug, arguments, _propose, _list, save_steps, _runs, _start, _finish, _run_step) do
    with {:ok, steps} <- required_steps(arguments),
         {:ok, saved} <- save_steps.(project_slug, steps) do
      presented = Enum.map(saved, &DevEnvPresenter.step/1)

      {:ok,
       %{
         tool: @tool,
         message: "Saved #{length(presented)} dev-env step(s).",
         data: %{steps: presented}
       }}
    end
  end

  defp execute_action(:list_runs, project_slug, _arguments, _propose, _list, _save, list_runs, _start, _finish, _run_step) do
    runs = list_runs.(project_slug) |> Enum.map(&DevEnvPresenter.run/1)

    {:ok,
     %{
       tool: @tool,
       message: "Found #{length(runs)} dev-env run(s).",
       data: %{runs: runs}
     }}
  end

  defp execute_action(:run, project_slug, arguments, _propose, list_steps, _save, list_runs, start_run, finish_run, run_step) do
    with {:ok, run} <- start_run.(project_slug),
         steps <- filtered_steps(list_steps.(project_slug), arguments),
         :ok <- run_steps(project_slug, run, steps, run_step),
         {:ok, finished} <- finish_run.(run) do
      reloaded = list_runs.(project_slug) |> Enum.find(&(&1.id == finished.id)) || finished

      {:ok,
       %{
         tool: @tool,
         message: "Ran #{length(steps)} dev-env step(s).",
         data: %{run: DevEnvPresenter.run(reloaded)}
       }}
    end
  end

  defp execute_action(:run_step, project_slug, arguments, _propose, list_steps, _save, _list_runs, start_run, finish_run, run_step) do
    with {:ok, run} <- start_run.(project_slug),
         {:ok, step_id} <- required_step_id(arguments),
         step when not is_nil(step) <- find_step(list_steps.(project_slug), step_id, arguments),
         {:ok, step_run} <- run_step.(project_slug, run, step),
         {:ok, _finished} <- finish_run.(run) do
      {:ok,
       %{
         tool: @tool,
         message: "Ran dev-env step #{step_id}.",
         data: %{step_run: DevEnvPresenter.step_run(step_run)}
       }}
    else
      nil -> {:error, :step_not_found}
    end
  end

  defp run_steps(_project_slug, _run, [], _run_step), do: :ok

  defp run_steps(project_slug, run, steps, run_step) do
    case Enum.find_value(steps, fn step ->
           case run_step.(project_slug, run, step) do
             {:ok, _step_run} -> nil
             {:error, reason} -> {:error, reason}
           end
         end) do
      nil -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp find_step(steps, step_id, arguments) do
    steps
    |> filtered_steps(arguments)
    |> Enum.find(&(to_string(&1.id) == step_id))
  end

  defp filtered_steps(steps, arguments) do
    case normalize_category_filter(Map.get(arguments, "category_filter")) do
      nil -> steps
      role -> Enum.filter(steps, &(&1.role == role))
    end
  end

  defp normalize_category_filter(value) when value in [nil, ""], do: nil

  defp normalize_category_filter(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_category_filter(_value), do: nil

  defp authorize_action(action, opts) do
    allowed =
      if Keyword.get(opts, :coding_agent, false) do
        @coding_agent_actions
      else
        @assistant_actions
      end

    if action in allowed, do: :ok, else: {:error, :action_not_allowed}
  end

  defp normalize_action(action) when is_binary(action) do
    case String.trim(action) |> String.downcase() do
      "list_steps" -> {:ok, :list_steps}
      "propose_steps" -> {:ok, :propose_steps}
      "save_steps" -> {:ok, :save_steps}
      "run" -> {:ok, :run}
      "run_step" -> {:ok, :run_step}
      "list_runs" -> {:ok, :list_runs}
      "warm_up" -> {:ok, :warm_up}
      other -> {:error, {:invalid_dev_env_action, other}}
    end
  end

  defp normalize_action(action), do: {:error, {:invalid_dev_env_action, action}}

  defp required_steps(arguments) do
    case Map.get(arguments, "steps") do
      steps when is_list(steps) -> {:ok, steps}
      _ -> {:error, :missing_steps}
    end
  end

  defp required_step_id(arguments) do
    case Map.get(arguments, "step_id") do
      id when is_integer(id) ->
        {:ok, Integer.to_string(id)}

      id when is_binary(id) ->
        case String.trim(id) do
          "" -> {:error, :missing_step_id}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_step_id}
    end
  end

  defp action_input_schema(actions, opts) do
    properties =
      %{
        "action" => %{
          "type" => "string",
          "enum" => Enum.map(actions, &Atom.to_string/1),
          "description" => "Dev-env action."
        },
        "step_id" => %{
          "type" => ["string", "integer", "null"],
          "description" => "Required for run_step."
        },
        "category_filter" => %{
          "type" => ["string", "null"],
          "description" => "Optional filter when running steps, e.g. serve."
        }
      }

    properties =
      if Keyword.get(opts, :include_steps, false) do
        Map.put(properties, "steps", %{
          "type" => ["array", "null"],
          "description" => "Required for save_steps."
        })
      else
        properties
      end

    %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["action"],
      "properties" => properties
    }
  end

  defp tool_spec(description, input_schema) do
    %{"name" => @tool, "description" => String.trim(description), "inputSchema" => input_schema}
  end
end
