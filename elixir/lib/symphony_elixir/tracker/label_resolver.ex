defmodule SymphonyElixir.Tracker.LabelResolver do
  @moduledoc """
  Resolves tracker label identifiers (remote ids or local names) to the
  human-readable label names shown in the UI.
  """

  import Ecto.Query

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
        catalog_name(catalog, trimmed)

      match = Repo.get_by(Label, project_id: project_id, remote_id: trimmed) ->
        human_name(match.name)

      match = Repo.get_by(Label, project_id: project_id, name: trimmed) ->
        human_name(match.name)

      true ->
        human_name(trimmed)
    end
  end

  defp resolve_one(_project_id, _catalog, _value), do: nil

  defp github_label_id?(value), do: Regex.match?(@github_label_id_pattern, value)

  # Build the id->name catalog from the local label table and, for remote-backed
  # projects, merge the provider's label list. Never call IssueAdapter.list_labels
  # here — that path recurses through to_dto/labels_to_names.
  defp catalog_by_id(%Project{} = project) do
    cache_key = {:symphony_label_catalog, project.id}

    case Process.get(cache_key) do
      catalog when is_map(catalog) ->
        catalog

      _ ->
        catalog = build_catalog(project)
        Process.put(cache_key, catalog)
        catalog
    end
  end

  defp build_catalog(%Project{id: project_id} = project) do
    local =
      Label
      |> where([label], label.project_id == ^project_id)
      |> Repo.all()
      |> Enum.reduce(%{}, &accrue_local_label/2)

    Map.merge(remote_catalog(project), local)
  end

  defp accrue_local_label(%Label{} = label, acc) do
    acc =
      if is_binary(label.remote_id) and label.remote_id != "" and human_label_name?(label.name) do
        put_catalog_entry(acc, label.remote_id, label.name)
      else
        acc
      end

    if human_label_name?(label.name) do
      put_catalog_entry(acc, label.name, label.name)
    else
      acc
    end
  end

  defp catalog_name(catalog, id) do
    catalog
    |> Map.fetch!(id)
    |> human_name()
  end

  defp human_label_name?(name) when is_binary(name), do: not github_label_id?(name)
  defp human_label_name?(_name), do: false

  defp human_name(name) when is_binary(name) do
    if github_label_id?(name), do: nil, else: name
  end

  defp human_name(_name), do: nil

  defp put_catalog_entry(acc, id, name)
       when is_binary(id) and id != "" and is_binary(name) and name != "" do
    Map.put(acc, id, name)
  end

  defp put_catalog_entry(acc, _id, _name), do: acc

  defp remote_catalog(%Project{} = project) do
    case IssueAdapter.remote_for(project.tracker_kind) do
      nil ->
        %{}

      adapter ->
        case adapter.list_labels(project) do
          {:ok, labels} when is_list(labels) -> remote_labels_to_catalog(labels)
          _ -> %{}
        end
    end
  end

  defp remote_labels_to_catalog(labels) do
    Enum.reduce(labels, %{}, fn label, acc ->
      id = label_id(label)
      name = label_name(label)

      if is_binary(id) and id != "" and is_binary(name) and name != "" do
        Map.put(acc, id, name)
      else
        acc
      end
    end)
  end

  defp label_id(label) when is_map(label) do
    Map.get(label, :id) || Map.get(label, "id")
  end

  defp label_name(label) when is_map(label) do
    Map.get(label, :name) || Map.get(label, "name")
  end
end
