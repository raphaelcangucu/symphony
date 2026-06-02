defmodule SymphonyElixir.Jira.Tracker do
  @moduledoc """
  JIRA Cloud-backed tracker implementation (orchestrator poll boundary).
  """

  @behaviour SymphonyElixir.Tracker

  alias SymphonyElixir.Jira.{Adf, Client, Config}

  @spec project_identity() :: String.t() | nil
  def project_identity, do: Config.project_key()

  @spec default_prompt_template() :: String.t()
  def default_prompt_template do
    """
    You are working on a JIRA issue.

    Identifier: {{ issue.identifier }}
    Title: {{ issue.title }}

    Body:
    {% if issue.description %}
    {{ issue.description }}
    {% else %}
    No description provided.
    {% endif %}
    """
  end

  @spec fetch_candidate_issues() :: {:ok, [term()]} | {:error, term()}
  def fetch_candidate_issues, do: client_module().fetch_candidate_issues()

  @spec fetch_issues_by_states([String.t()]) :: {:ok, [term()]} | {:error, term()}
  def fetch_issues_by_states(states), do: client_module().fetch_issues_by_states(states)

  @spec fetch_issue_states_by_ids([String.t()]) :: {:ok, [term()]} | {:error, term()}
  def fetch_issue_states_by_ids(issue_ids), do: client_module().fetch_issue_states_by_ids(issue_ids)

  @spec create_comment(String.t(), String.t()) :: :ok | {:error, term()}
  def create_comment(issue_key, body) when is_binary(issue_key) and is_binary(body) do
    path = "/rest/api/3/issue/#{issue_key}/comment"

    case client_module().request(:post, path, %{"body" => Adf.from_text(body)}, []) do
      {:ok, _response} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @spec update_issue_state(String.t(), String.t()) :: :ok | {:error, term()}
  def update_issue_state(issue_key, state_name)
      when is_binary(issue_key) and is_binary(state_name) do
    with {:ok, transition_id} <- resolve_transition_id(issue_key, state_name),
         {:ok, _response} <-
           client_module().request(
             :post,
             "/rest/api/3/issue/#{issue_key}/transitions",
             %{"transition" => %{"id" => transition_id}},
             []
           ) do
      :ok
    end
  end

  defp resolve_transition_id(issue_key, state_name) do
    case client_module().request(:get, "/rest/api/3/issue/#{issue_key}/transitions", nil, []) do
      {:ok, %{"transitions" => transitions}} when is_list(transitions) ->
        transitions
        |> Enum.find(fn transition -> get_in(transition, ["to", "name"]) == state_name end)
        |> case do
          %{"id" => id} when is_binary(id) -> {:ok, id}
          _ -> {:error, :transition_not_found}
        end

      {:ok, _response} ->
        {:error, :transition_not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp client_module do
    Application.get_env(:symphony_elixir, :jira_client_module, Client)
  end
end
