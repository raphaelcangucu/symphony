defmodule SymphonyElixir.LocalTracker.Context.AgentSettings do
  @moduledoc """
  Persistence for per-issue agent overrides (`agent_kind` / `model` / `effort` /
  `mode`), keyed by `project_slug` + `identifier`. Split out of
  `LocalTracker.Context` so the read/upsert rules for agent settings live behind
  a focused API.
  """

  alias SymphonyElixir.LocalTracker.IssueAgentSettings
  alias SymphonyElixir.Repo

  @agent_settings_keys ~w(agent_kind model effort mode)a

  @doc """
  Reads the persisted per-issue agent overrides keyed by `project_slug` +
  `identifier`. Returns `{:ok, settings}` or `{:error, :not_found}`.
  """
  @spec get(String.t(), String.t()) ::
          {:ok, IssueAgentSettings.t()} | {:error, :not_found}
  def get(project_slug, identifier)
      when is_binary(project_slug) and is_binary(identifier) do
    case Repo.get_by(IssueAgentSettings, project_slug: project_slug, identifier: identifier) do
      nil -> {:error, :not_found}
      %IssueAgentSettings{} = settings -> {:ok, settings}
    end
  end

  @doc """
  Upserts the per-issue agent overrides. Only the keys present in `attrs`
  (`agent_kind`, `model`, `effort`, `mode`) are written; nil/blank values are
  dropped and omitted keys preserve their previously stored value.
  """
  @spec put(String.t(), String.t(), map()) ::
          :ok | {:error, Ecto.Changeset.t()}
  def put(project_slug, identifier, attrs)
      when is_binary(project_slug) and is_binary(identifier) and is_map(attrs) do
    cleaned = clean_agent_settings(attrs)

    changeset =
      IssueAgentSettings.changeset(
        %IssueAgentSettings{},
        Map.merge(cleaned, %{project_slug: project_slug, identifier: identifier})
      )

    if changeset.valid? do
      set = Keyword.put(Map.to_list(cleaned), :updated_at, DateTime.utc_now())

      case Repo.insert(changeset,
             on_conflict: [set: set],
             conflict_target: [:project_slug, :identifier]
           ) do
        {:ok, _record} -> :ok
        {:error, changeset} -> {:error, changeset}
      end
    else
      {:error, changeset}
    end
  end

  defp clean_agent_settings(attrs) do
    Enum.reduce(@agent_settings_keys, %{}, fn key, acc ->
      raw = Map.get(attrs, key, Map.get(attrs, Atom.to_string(key)))

      case blank_to_nil(raw) do
        nil -> acc
        value -> Map.put(acc, key, value)
      end
    end)
  end

  defp blank_to_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp blank_to_nil(value), do: value
end
