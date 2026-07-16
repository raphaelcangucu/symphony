defmodule SymphonyElixir.Assistant.ObservabilityTools do
  @moduledoc """
  Read-only observability tools for the global (freeform) Maestro. Surfaces the
  live per-runtime aggregate the Observability page renders so the assistant can
  reason about active runs, retries, and agent usage across projects.
  """

  alias SymphonyElixir.Observability.Registry

  @tools ~w(list_observability_runtimes)

  @spec tools() :: [String.t()]
  def tools, do: @tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      tool_spec(
        "list_observability_runtimes",
        "List live Symphony runtimes reported to the observability hub (the same data the Observability page shows): status (online/stale), running/retrying counts, running items, and per-agent usage totals. Optionally filter by project_slug.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "properties" => %{
            "project_slug" => %{
              "type" => "string",
              "description" => "When set, only return runtimes reporting for this project slug."
            }
          }
        }
      )
    ]
  end

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(tool, arguments, opts \\ [])

  def execute("list_observability_runtimes", arguments, _opts) when is_map(arguments) do
    filter = normalize_project_filter(Map.get(arguments, "project_slug"))

    runtimes =
      Registry.list()
      |> filter_by_project(filter)

    {:ok,
     %{
       tool: "list_observability_runtimes",
       message: runtimes_message(runtimes, filter),
       data: %{runtimes: runtimes}
     }}
  end

  def execute(tool, _arguments, _opts), do: {:error, {:unsupported_tool, tool}}

  defp normalize_project_filter(slug) when is_binary(slug) do
    case String.trim(slug) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_project_filter(_slug), do: nil

  defp filter_by_project(runtimes, nil), do: runtimes

  defp filter_by_project(runtimes, slug) do
    Enum.filter(runtimes, fn runtime ->
      to_string(Map.get(runtime, :project_slug) || Map.get(runtime, "project_slug")) == slug
    end)
  end

  defp runtimes_message(runtimes, nil), do: "Found #{length(runtimes)} live runtime(s)."

  defp runtimes_message(runtimes, slug),
    do: "Found #{length(runtimes)} live runtime(s) for #{slug}."

  defp tool_spec(name, description, input_schema) do
    %{"name" => name, "description" => description, "inputSchema" => input_schema}
  end
end
