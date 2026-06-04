defmodule SymphonyElixir.Jira.Discovery do
  @moduledoc false

  alias SymphonyElixir.Jira.Client

  @search_path "/rest/api/3/project/search?maxResults=50&orderBy=name"

  @spec list_projects(keyword()) :: {:ok, [map()]} | {:error, term()}
  def list_projects(opts \\ []) when is_list(opts) do
    cond do
      missing_credentials?() ->
        {:error, :missing_jira_credentials}

      true ->
        case Client.request(:get, @search_path, nil, opts) do
          {:ok, %{"values" => values}} when is_list(values) ->
            {:ok, Enum.map(values, &project_dto/1)}

          {:ok, body} ->
            {:ok, List.wrap(Map.get(body, "values")) |> Enum.map(&project_dto/1)}

          {:error, reason} ->
            {:error, reason}
        end
    end
  end

  defp missing_credentials? do
    is_nil(SymphonyElixir.Jira.Config.api_token()) or
      is_nil(SymphonyElixir.Jira.Config.email()) or
      is_nil(SymphonyElixir.Jira.Config.base_url())
  end

  defp project_dto(%{"id" => id, "key" => key, "name" => name} = project) do
    %{
      id: to_string(id),
      key: key,
      name: name,
      projectTypeKey: Map.get(project, "projectTypeKey"),
      simplified: Map.get(project, "simplified"),
      style: Map.get(project, "style")
    }
  end

  defp project_dto(_), do: %{}
end
