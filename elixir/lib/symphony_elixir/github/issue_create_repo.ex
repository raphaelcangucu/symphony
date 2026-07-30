defmodule SymphonyElixir.GitHub.IssueCreateRepo do
  @moduledoc """
  Resolves which GitHub repository receives a newly created issue on multi-repo
  GitHub Project boards.

  Resolution order for `resolve/2` (first candidate):

  1. Explicit `repository` / `repo` in create attrs (assistant tools)
  2. Label inference (`area:backend` → linked repo whose name or role matches)
  3. `tracker.config.repo` fallback

  `candidates/2` returns that preferred repo plus remaining linked fallbacks so
  create can retry when the preferred repository has Issues disabled.
  """

  alias SymphonyElixir.LocalTracker.{Context, Project}

  @type error :: {:invalid_repository, String.t()}

  @spec resolve(Project.t(), map()) :: {:ok, String.t()} | {:error, error()}
  def resolve(%Project{} = project, attrs) when is_map(attrs) do
    allowed = allowed_repos(project)

    repo =
      explicit_repo(attrs) ||
        infer_from_labels(project, attrs) ||
        tracker_repo(project)

    with true <- is_binary(repo) and repo != "",
         :ok <- validate_allowed(repo, allowed) do
      {:ok, repo}
    else
      false ->
        {:error, {:invalid_repository, "repository is required — pass repository on create_issue or set tracker.config.repo"}}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Ordered create targets: preferred repo first, then `tracker.config.repo`, then
  other linked repositories (primary role first). Duplicates and unlinked repos
  are removed.

  An explicit repository that is not linked to the project is omitted; callers
  should use `resolve/2` first when they need a hard validation error.
  """
  @spec candidates(Project.t(), map()) :: [String.t()]
  def candidates(%Project{} = project, attrs) when is_map(attrs) do
    allowed = allowed_repos(project)
    linked = linked_repos(project)

    preferred =
      case resolve(project, attrs) do
        {:ok, repo} -> repo
        {:error, _} -> nil
      end

    fallback = tracker_repo(project)

    [preferred, fallback | linked]
    |> Enum.filter(&(is_binary(&1) and String.trim(&1) != ""))
    |> Enum.map(&String.trim/1)
    |> Enum.uniq()
    |> Enum.filter(&allowed_repo?(&1, allowed))
  end

  @spec explicit_repo(map()) :: String.t() | nil
  def explicit_repo(attrs) when is_map(attrs) do
    attrs
    |> Map.take(["repository", "repo"])
    |> Map.values()
    |> Enum.find(&(is_binary(&1) and String.trim(&1) != ""))
    |> case do
      repo when is_binary(repo) -> String.trim(repo)
      _ -> nil
    end
  end

  defp infer_from_labels(%Project{} = project, attrs) do
    labels =
      (string_list(Map.get(attrs, "label_ids")) ++ string_list(Map.get(attrs, "labels")))
      |> Enum.map(&String.downcase/1)

    case Enum.find(labels, &String.starts_with?(&1, "area:")) do
      "area:" <> area ->
        area = String.trim(area)

        project.slug
        |> Context.list_repositories()
        |> Enum.find_value(&match_area_repo(&1, area))

      _ ->
        nil
    end
  end

  defp match_area_repo(%{github_full_name: full, role: role}, area)
       when is_binary(full) and is_binary(area) and area != "" do
    lowered_full = String.downcase(full)
    lowered_role = String.downcase(role || "")
    lowered_area = String.downcase(area)

    cond do
      String.ends_with?(lowered_full, "/" <> lowered_area) ->
        full

      lowered_role == lowered_area ->
        full

      lowered_area == "admin" and lowered_role in ["frontend", "primary"] and
          String.contains?(lowered_full, "admin") ->
        full

      true ->
        nil
    end
  end

  defp match_area_repo(_repo, _area), do: nil

  defp linked_repos(%Project{slug: slug}) when is_binary(slug) do
    slug
    |> Context.list_repositories()
    |> Enum.sort_by(fn repo -> if repo.role == "primary", do: 0, else: 1 end)
    |> Enum.map(& &1.github_full_name)
  end

  defp linked_repos(_project), do: []

  defp allowed_repos(%Project{slug: slug}) do
    case Context.list_repositories(slug) do
      [] -> :any
      repos -> MapSet.new(repos, & &1.github_full_name)
    end
  end

  defp validate_allowed(_repo, :any), do: :ok

  defp validate_allowed(repo, %MapSet{} = allowed) do
    if MapSet.member?(allowed, repo) do
      :ok
    else
      {:error, {:invalid_repository, "repository #{repo} is not linked to this project"}}
    end
  end

  defp allowed_repo?(_repo, :any), do: true
  defp allowed_repo?(repo, %MapSet{} = allowed), do: MapSet.member?(allowed, repo)

  defp tracker_repo(%Project{tracker_config: %{"repo" => repo}}) when is_binary(repo) do
    case String.trim(repo) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp tracker_repo(_project), do: nil

  defp string_list(values) when is_list(values),
    do: Enum.filter(values, &(is_binary(&1) and String.trim(&1) != ""))

  defp string_list(value) when is_binary(value), do: [value]
  defp string_list(_value), do: []
end
