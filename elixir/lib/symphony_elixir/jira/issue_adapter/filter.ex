defmodule SymphonyElixir.Jira.IssueAdapter.Filter do
  @moduledoc """
  Builds the per-project board search JQL for `Jira.IssueAdapter` from a
  project's `tracker_config`:

    * `project_key` (required) — always scoped as `project = "KEY"`.
    * `fields` (map) — `%{"Product" => "Inspire"}` → `"Product" = "Inspire"`
      equality clauses, AND-joined (ordered by field name for determinism).
    * `jql` (string) — optional raw fragment, parenthesized and ANDed after fields.
    * `order_by` (string) — optional, defaults to `created DESC`.

  Blank field names/values and a blank `jql` are dropped. With no `fields` and no
  `jql` the result is `project = "KEY" ORDER BY created DESC` (legacy behavior).
  """

  alias SymphonyElixir.LocalTracker.Project

  @default_order_by "created DESC"

  @spec build_jql(Project.t()) :: String.t()
  def build_jql(%Project{tracker_config: config}) when is_map(config) do
    project_key = Map.fetch!(config, "project_key")

    clauses =
      [project_clause(project_key)]
      |> Kernel.++(field_clauses(Map.get(config, "fields")))
      |> Kernel.++([raw_clause(Map.get(config, "jql"))])
      |> Enum.reject(&is_nil/1)

    Enum.join(clauses, " AND ") <> " ORDER BY " <> order_by(Map.get(config, "order_by"))
  end

  defp project_clause(project_key), do: "project = " <> quote_jql(project_key)

  defp field_clauses(fields) when is_map(fields) do
    fields
    |> Enum.map(fn {name, value} -> {present(name), present(value)} end)
    |> Enum.reject(fn {name, value} -> is_nil(name) or is_nil(value) end)
    |> Enum.sort_by(fn {name, _value} -> name end)
    |> Enum.map(fn {name, value} -> quote_jql(name) <> " = " <> quote_jql(value) end)
  end

  defp field_clauses(_fields), do: []

  defp raw_clause(jql) do
    case present(jql) do
      nil -> nil
      fragment -> "(" <> fragment <> ")"
    end
  end

  defp order_by(value), do: present(value) || @default_order_by

  defp quote_jql(value) do
    "\"" <> (value |> to_string() |> String.replace("\"", "\\\"")) <> "\""
  end

  defp present(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp present(value) when is_integer(value) or is_float(value), do: to_string(value)
  defp present(_value), do: nil
end
