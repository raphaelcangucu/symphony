defmodule SymphonyElixir.GitHub.Blockers do
  @moduledoc false

  @body_pattern ~r/(?:Blocked\s+by|Depends\s+on)\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)/i

  @spec from_tracked(map() | nil) :: [map()]
  def from_tracked(%{"trackedInIssues" => %{"nodes" => nodes}}) when is_list(nodes) do
    Enum.flat_map(nodes, &blocker_from_tracked_node/1)
  end

  def from_tracked(_issue), do: []

  @spec from_body(String.t() | nil, String.t()) :: [map()]
  def from_body(body, default_repo) when is_binary(body) and is_binary(default_repo) do
    @body_pattern
    |> Regex.scan(body)
    |> Enum.map(fn
      [_, repo, number] ->
        repo_name = if is_binary(repo) and repo != "", do: repo, else: default_repo
        build_blocker(nil, repo_name, number, nil)

      _ ->
        nil
    end)
    |> Enum.reject(&is_nil/1)
  end

  def from_body(_body, _default_repo), do: []

  @spec merge([map()], [map()]) :: [map()]
  def merge(tracked, parsed) when is_list(tracked) and is_list(parsed) do
    tracked_map = index_blockers_by_identifier(tracked)
    merged = merge_parsed_blockers(parsed, tracked_map)
    Map.values(merged)
  end

  defp index_blockers_by_identifier(blockers) do
    Enum.reduce(blockers, %{}, fn blocker, acc ->
      Map.put(acc, blocker[:identifier], blocker)
    end)
  end

  defp merge_parsed_blockers(parsed, tracked_map) do
    Enum.reduce(parsed, tracked_map, fn blocker, acc ->
      if Map.has_key?(acc, blocker[:identifier]), do: acc, else: Map.put(acc, blocker[:identifier], blocker)
    end)
  end

  defp blocker_from_tracked_node(%{
         "id" => id,
         "number" => number,
         "state" => state,
         "repository" => %{"nameWithOwner" => repo}
       })
       when is_binary(id) and is_integer(number) and is_binary(state) and is_binary(repo) do
    [build_blocker(id, repo, Integer.to_string(number), state)]
  end

  defp blocker_from_tracked_node(%{
         "id" => id,
         "number" => number,
         "repository" => %{"nameWithOwner" => repo}
       })
       when is_binary(id) and is_integer(number) and is_binary(repo) do
    [build_blocker(id, repo, Integer.to_string(number), nil)]
  end

  defp blocker_from_tracked_node(%{
         "number" => number,
         "repository" => %{"nameWithOwner" => repo}
       })
       when is_integer(number) and is_binary(repo) do
    [build_blocker(nil, repo, Integer.to_string(number), nil)]
  end

  defp blocker_from_tracked_node(_), do: []

  defp build_blocker(id, repo, number, state) when is_binary(repo) and is_binary(number) do
    %{
      id: id,
      identifier: "#{repo}##{number}",
      state: state
    }
  end
end
