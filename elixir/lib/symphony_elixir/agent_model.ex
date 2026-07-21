defmodule SymphonyElixir.AgentModel do
  @moduledoc """
  Validates a per-agent model selection against the agent's discoverable catalog.

  Symphony persists a `model` override in several places (per-issue execution
  settings, assistant thread sessions, project defaults). Historically only the
  instance-level `Settings.AgentModels` group validated its value, so an operator
  could pin a model the agent CLI does not actually offer — a typo or a
  decommissioned model such as `gpt-5.6-terra`. That value then flows straight to
  the Codex `turn/start` request and the run fails or behaves unexpectedly.

  This module is the single boundary that answers "is this a real model for this
  agent?", reusing the same catalogs the composer UI shows so accepted values and
  offered values never drift. Resolution is deliberately fail-open: a blank model
  (CLI default), an unknown agent kind, or a momentarily-unavailable catalog is
  accepted, so validation never blocks a run on a discovery hiccup. Only a model
  that is positively absent from a non-empty catalog is rejected.
  """

  alias SymphonyElixir.Settings.AgentModels

  @agent_catalogs %{
    "codex" => SymphonyElixir.Codex.ModelCatalog,
    "claude" => SymphonyElixir.Claude.ModelCatalog,
    "cursor" => SymphonyElixir.Cursor.ModelCatalog,
    "opencode" => SymphonyElixir.OpenCode.ModelCatalog
  }

  @type validation_error :: %{
          agent_kind: String.t(),
          model: String.t(),
          valid_models: [String.t()]
        }

  @doc """
  Validate `model` for `agent_kind`.

  Returns `:ok` when the model is acceptable, or `{:error, error}` describing the
  rejected model and the list of valid models for the agent.
  """
  @spec validate(String.t() | nil, String.t() | nil) :: :ok | {:error, validation_error()}
  def validate(agent_kind, model)

  def validate(_agent_kind, model) when model in [nil, ""], do: :ok

  def validate(agent_kind, model) when is_binary(agent_kind) and is_binary(model) do
    case String.trim(model) do
      "" -> :ok
      trimmed -> validate_trimmed(agent_kind, trimmed)
    end
  end

  def validate(_agent_kind, _model), do: :ok

  defp validate_trimmed(agent_kind, model) do
    case known_models(agent_kind) do
      [] ->
        :ok

      models ->
        if model in models do
          :ok
        else
          {:error, %{agent_kind: agent_kind, model: model, valid_models: models}}
        end
    end
  end

  @doc """
  Known model ids for an agent kind (dynamic catalog unioned with the curated
  instance catalog), or `[]` when nothing is discoverable.
  """
  @spec known_models(String.t()) :: [String.t()]
  def known_models(agent_kind) when is_binary(agent_kind) do
    (catalog_models(agent_kind) ++ curated_models(agent_kind))
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.uniq()
  end

  def known_models(_agent_kind), do: []

  defp catalog_models(agent_kind) do
    case Map.get(@agent_catalogs, agent_kind) do
      nil -> []
      module -> from_catalog(module)
    end
  end

  defp from_catalog(module) do
    case module.list_models() do
      {:ok, %{models: models}} when is_list(models) -> Enum.map(models, &model_id/1)
      _ -> []
    end
  rescue
    _ -> []
  end

  defp curated_models(agent_kind), do: AgentModels.options(agent_kind)

  defp model_id(%{model: model}) when is_binary(model), do: model
  defp model_id(%{"model" => model}) when is_binary(model), do: model
  defp model_id(%{id: id}) when is_binary(id), do: id
  defp model_id(%{"id" => id}) when is_binary(id), do: id
  defp model_id(_model), do: nil
end
