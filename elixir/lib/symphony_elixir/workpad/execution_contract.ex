defmodule SymphonyElixir.Workpad.ExecutionContract do
  @moduledoc """
  Parses the machine-readable execution contract embedded in a `## Codex Workpad`.

  The workpad stays the human-visible source of truth, while this module gives
  the runner a small structured view for scope and gate decisions.
  """

  @type task_status :: :done | :partial | :pending
  @type task :: %{
          status: task_status(),
          title: String.t(),
          remaining: [String.t()],
          validation: String.t() | nil,
          evidence: String.t() | nil,
          commit: String.t() | nil
        }

  @type t :: %__MODULE__{
          source_plan: String.t() | nil,
          mode: String.t() | nil,
          scope_status: String.t() | nil,
          tasks: [task()],
          scope_complete?: boolean(),
          final_validate_allowed?: boolean(),
          final_publish_allowed?: boolean(),
          next_incomplete: task() | nil
        }

  defstruct source_plan: nil,
            mode: nil,
            scope_status: nil,
            tasks: [],
            scope_complete?: false,
            final_validate_allowed?: false,
            final_publish_allowed?: false,
            next_incomplete: nil

  @section_heading ~r/^\s*\#{1,6}\s+/
  @task_line ~r/^\s*-\s+\[(?<marker>[xX~ ])\]\s+(?<title>.+?)\s*$/
  @task_meta_line ~r/^\s*(?<key>validation|evidence|commit):\s*(?<value>.+?)\s*$/i
  @remaining_item ~r/^\s*-\s+(?<item>.+?)\s*$/

  @doc """
  Parses the execution contract metadata and task checklist from the workpad's
  canonical `### Plan` section.
  """
  @spec parse(String.t() | nil) :: {:ok, t()} | :absent
  def parse(body) when is_binary(body) do
    case parse_plan_section(body) do
      {:ok, contract} -> {:ok, contract}
      :absent -> :absent
    end
  end

  def parse(_body), do: :absent

  @doc """
  Validates the minimum workpad contract required by the plan gate.
  """
  @spec validate_workpad(String.t() | nil, keyword()) ::
          :ok | {:error, :plan_absent | :acceptance_criteria_absent | :contract_absent}
  def validate_workpad(body, opts \\ [])

  def validate_workpad(body, opts) when is_binary(body) do
    cond do
      section(body, "Plan") == :error ->
        {:error, :plan_absent}

      section(body, "Acceptance criteria") == :error ->
        {:error, :acceptance_criteria_absent}

      true ->
        validate_contract_presence(body, Keyword.get(opts, :require_execution_contract, false))
    end
  end

  def validate_workpad(_body, _opts), do: {:error, :plan_absent}

  @doc """
  Returns true when the parsed contract represents complete plan scope.
  """
  @spec scope_complete?(t() | :absent | {:error, term()}) :: boolean()
  def scope_complete?(%__MODULE__{scope_complete?: value}), do: value
  def scope_complete?(_contract), do: false

  @doc """
  Returns the first partial or pending task, when available.
  """
  @spec next_incomplete(t() | :absent | {:error, term()}) :: task() | nil
  def next_incomplete(%__MODULE__{next_incomplete: task}), do: task
  def next_incomplete(_contract), do: nil

  defp validate_contract_presence(body, require_execution_contract?) do
    case parse(body) do
      {:ok, _contract} -> :ok
      :absent when require_execution_contract? -> {:error, :contract_absent}
      :absent -> :ok
    end
  end

  defp parse_plan_section(body) do
    case section(body, "Plan") do
      {:ok, plan_section} ->
        fields = parse_fields(plan_section)
        tasks = parse_tasks(plan_section)

        if contract_fields_present?(fields) do
          {:ok, build(fields, tasks)}
        else
          :absent
        end

      :error ->
        :absent
    end
  end

  defp contract_fields_present?(fields) do
    fields
    |> Map.take(["source_plan", "mode", "scope_status"])
    |> map_size() == 3
  end

  defp section(body, title) do
    lines = String.split(body, ~r/\R/)
    title = String.downcase(title)

    {section_lines, _state} =
      Enum.reduce(lines, {[], :before}, fn line, {acc, state} ->
        cond do
          heading?(line, title) ->
            {acc, :inside}

          state == :inside and Regex.match?(@section_heading, line) ->
            {acc, :after}

          state == :inside ->
            {[line | acc], :inside}

          true ->
            {acc, state}
        end
      end)

    case Enum.reverse(section_lines) do
      [] -> :error
      section_lines -> {:ok, Enum.join(section_lines, "\n")}
    end
  end

  defp heading?(line, expected_title) do
    normalized =
      line
      |> String.trim()
      |> String.trim_leading("#")
      |> String.trim()
      |> String.downcase()

    normalized == expected_title
  end

  defp parse_fields(section) do
    section
    |> String.split(~r/\R/)
    |> Enum.reduce(%{}, fn line, acc ->
      case String.split(line, ":", parts: 2) do
        [key, value] -> Map.put(acc, normalize_key(key), String.trim(value))
        _other -> acc
      end
    end)
  end

  defp normalize_key(key) do
    key
    |> String.trim()
    |> String.downcase()
  end

  defp parse_tasks(section) do
    section
    |> String.split(~r/\R/)
    |> Enum.reduce([], &accumulate_task/2)
    |> Enum.reverse()
  end

  defp accumulate_task(line, tasks) do
    cond do
      match = Regex.named_captures(@task_line, line) ->
        [new_task(match) | tasks]

      match = Regex.named_captures(@task_meta_line, line) ->
        add_task_meta(tasks, match["key"], match["value"])

      match = Regex.named_captures(@remaining_item, line) ->
        add_remaining(tasks, match["item"])

      true ->
        tasks
    end
  end

  defp new_task(%{"marker" => marker, "title" => title}) do
    %{
      status: marker_status(marker),
      title: String.trim(title),
      remaining: [],
      validation: nil,
      evidence: nil,
      commit: nil
    }
  end

  defp marker_status(marker) when marker in ["x", "X"], do: :done
  defp marker_status("~"), do: :partial
  defp marker_status(_marker), do: :pending

  defp add_task_meta([task | rest], key, value) do
    normalized_key =
      key
      |> String.downcase()
      |> String.to_atom()

    [%{task | normalized_key => normalize_status_value(value)} | rest]
  end

  defp add_task_meta([], _key, _value), do: []

  defp add_remaining([task | rest], item) do
    [%{task | remaining: task.remaining ++ [String.trim(item)]} | rest]
  end

  defp add_remaining([], _item), do: []

  defp build(fields, tasks) do
    scope_status = Map.get(fields, "scope_status")
    requested_validate = truthy?(Map.get(fields, "final_validate_allowed"))
    requested_publish = truthy?(Map.get(fields, "final_publish_allowed"))
    complete? = scope_status == "complete" and tasks != [] and Enum.all?(tasks, &task_complete?/1)
    next_incomplete = Enum.find(tasks, &(not task_complete?(&1)))

    %__MODULE__{
      source_plan: blank_to_nil(Map.get(fields, "source_plan")),
      mode: blank_to_nil(Map.get(fields, "mode")),
      scope_status: blank_to_nil(scope_status),
      tasks: tasks,
      scope_complete?: complete?,
      final_validate_allowed?: complete? and requested_validate,
      final_publish_allowed?: complete? and requested_publish,
      next_incomplete: next_incomplete
    }
  end

  defp truthy?(value) when is_binary(value), do: String.downcase(String.trim(value)) == "true"
  defp truthy?(_value), do: false

  defp task_complete?(%{status: :done} = task) do
    validation_done?(task.validation) and evidence_done?(task.evidence) and commit_done?(task.commit)
  end

  defp task_complete?(_task), do: false

  defp validation_done?(value), do: value in ["passed", "n/a"]
  defp evidence_done?(value), do: value in ["done", "n/a"]
  defp commit_done?(value), do: value in ["done", "n/a"]

  defp normalize_status_value(value) do
    value
    |> String.trim()
    |> String.downcase()
  end

  defp blank_to_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp blank_to_nil(_value), do: nil
end
