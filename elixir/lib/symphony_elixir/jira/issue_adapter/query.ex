defmodule SymphonyElixir.Jira.IssueAdapter.Query do
  @moduledoc "JIRA REST field selectors + normalizers for the project UI adapter."

  alias SymphonyElixir.Jira.{Adf, Priority}
  alias SymphonyElixir.Tracker.IssueDTO

  @issue_fields ~w(summary description priority status assignee creator labels created updated)

  @type ctx :: %{required(:project_slug) => String.t() | nil, required(:base_url) => String.t() | nil}

  @spec issue_fields() :: [String.t()]
  def issue_fields, do: @issue_fields

  @spec normalize_issue(map(), ctx()) :: IssueDTO.t()
  def normalize_issue(node, ctx) when is_map(node) and is_map(ctx) do
    fields = Map.get(node, "fields") || %{}
    key = node["key"]

    IssueDTO.build(%{
      id: node["id"],
      identifier: key,
      title: fields["summary"],
      description: Adf.to_text(fields["description"]),
      priority: Priority.to_int(get_in(fields, ["priority", "name"])),
      url: browse_url(ctx[:base_url], key),
      assignee: get_in(fields, ["assignee", "displayName"]),
      creator: get_in(fields, ["creator", "displayName"]),
      labels: normalize_labels(fields["labels"]),
      status: status_to_dto(fields["status"], nil),
      project_slug: ctx[:project_slug],
      created_at: fields["created"],
      updated_at: fields["updated"]
    })
  end

  @spec statuses([map()]) :: [IssueDTO.status()]
  def statuses(issue_types) when is_list(issue_types) do
    issue_types
    |> Enum.flat_map(fn type -> List.wrap(type["statuses"]) end)
    |> Enum.uniq_by(& &1["name"])
    |> Enum.with_index()
    |> Enum.map(fn {status, index} -> status_to_dto(status, index) end)
  end

  def statuses(_response), do: []

  @spec labels(map()) :: [%{id: nil, name: String.t()}]
  def labels(%{"values" => values}) when is_list(values) do
    values
    |> Enum.filter(&is_binary/1)
    |> Enum.map(fn name -> %{id: nil, name: name} end)
  end

  def labels(_response), do: []

  @spec users([map()]) :: [map()]
  def users(response) when is_list(response) do
    Enum.map(response, fn user ->
      %{
        id: user["accountId"],
        login: user["displayName"],
        name: user["displayName"],
        avatar_url: get_in(user, ["avatarUrls", "48x48"])
      }
    end)
  end

  def users(_response), do: []

  @spec created_issue(map(), ctx(), String.t()) :: {:ok, IssueDTO.t()} | {:error, :create_failed}
  def created_issue(%{"key" => key} = response, ctx, title) when is_binary(key) do
    {:ok,
     IssueDTO.build(%{
       id: response["id"],
       identifier: key,
       title: title,
       url: browse_url(ctx[:base_url], key),
       project_slug: ctx[:project_slug]
     })}
  end

  def created_issue(_response, _ctx, _title), do: {:error, :create_failed}

  @spec category_for(String.t() | nil) :: String.t()
  def category_for("new"), do: "unstarted"
  def category_for("indeterminate"), do: "started"
  def category_for("done"), do: "completed"
  def category_for(_key), do: "unstarted"

  defp status_to_dto(nil, _position), do: nil

  defp status_to_dto(%{"name" => name} = status, position) do
    category = category_for(get_in(status, ["statusCategory", "key"]))
    %{name: name, category: category, position: position, is_terminal: category == "completed"}
  end

  defp status_to_dto(_status, _position), do: nil

  defp normalize_labels(labels) when is_list(labels), do: Enum.filter(labels, &is_binary/1)
  defp normalize_labels(_labels), do: []

  defp browse_url(base_url, key) when is_binary(base_url) and is_binary(key) do
    String.trim_trailing(base_url, "/") <> "/browse/" <> key
  end

  defp browse_url(_base_url, _key), do: nil
end
