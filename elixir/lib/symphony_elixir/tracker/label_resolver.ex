defmodule SymphonyElixir.Tracker.LabelResolver do
  @moduledoc """
  Resolves tracker label identifiers (remote ids or local names) to the
  human-readable label names shown in the UI.
  """

  alias SymphonyElixir.LocalTracker.Label
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.IssueAdapter

  @github_label_id_pattern ~r/^LA_[A-Za-z0-9_]+$/

  @spec resolve_names(Project.t(), [String.t()] | nil) :: [String.t()] | nil
  def resolve_names(_project, nil), do: nil

  def resolve_names(%Project{} = project, names) when is_list(names) do
    catalog = catalog_by_id(project)

    names
    |> Enum.map(&resolve_one(project.id, catalog, &1))
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
  end

  @spec display_name(Project.t(), String.t() | nil) :: String.t() | nil
  def display_name(_project, nil), do: nil

  def display_name(%Project{} = project, name) when is_binary(name) do
    trimmed = String.trim(name)

    cond do
      trimmed == "" ->
        nil

      github_label_id?(trimmed) ->
        resolve_one(project.id, catalog_by_id(project), trimmed)

      true ->
        trimmed
    end
  end

  def display_name(_project, _name), do: nil

  defp resolve_one(project_id, catalog, value) when is_binary(value) do
    trimmed = String.trim(value)

    cond do
      trimmed == "" ->
        nil

      Map.has_key?(catalog, trimmed) ->
        Map.fetch!(catalog, trimmed)

      match = Repo.get_by(Label, project_id: project_id, remote_id: trimmed) ->
        match.name

      match = Repo.get_by(Label, project_id: project_id, name: trimmed) ->
        match.name

      true ->
        trimmed
    end
  end

  defp resolve_one(_project_id, _catalog, _value), do: nil

  defp github_label_id?(value), do: Regex.match?(@github_label_id_pattern, value)

  defp catalog_by_id(%Project{} = project) do
    case IssueAdapter.dispatch(project, :list_labels, []) do
      {:ok, labels} when is_list(labels) ->
        labels
        |> Enum.reduce(%{}, fn label, acc ->
          id = label_id(label)
          name = label_name(label)

          if is_binary(id) and id != "" and is_binary(name) and name != "" do
            Map.put(acc, id, name)
          else
            acc
          end
        end)

      _ ->
        %{}
    end
  end

  defp label_id(label) when is_map(label) do
    Map.get(label, :id) || Map.get(label, "id")
  end

  defp label_name(label) when is_map(label) do
    Map.get(label, :name) || Map.get(label, "name")
  end
end
