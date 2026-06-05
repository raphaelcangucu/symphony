defmodule SymphonyElixir.Claude.ModelCatalog do
  @moduledoc """
  Static Claude Code model catalog, shaped exactly like
  `SymphonyElixir.Codex.ModelCatalog.catalog()`. Mirrors the reference
  bridge's model list; no efforts (reasoning effort is a Codex concept —
  the composer hides the menu when `efforts == []`).
  """

  alias SymphonyElixir.InstanceConfig

  @models [
    %{id: "claude-opus-4-6", label: "Claude Opus 4.6", default: true},
    %{id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", default: false},
    %{id: "claude-haiku-4-5", label: "Claude Haiku 4.5", default: false}
  ]

  @spec list_models(keyword()) :: {:ok, map()}
  def list_models(_opts \\ []) do
    models =
      Enum.map(@models, fn model ->
        %{
          id: model.id,
          model: model.id,
          label: model.label,
          is_default: model.default,
          default_effort: "",
          efforts: [],
          input_modalities: ["text", "image"]
        }
      end)

    {:ok,
     %{
       agent: "claude",
       agent_label: "Claude Code",
       command: InstanceConfig.claude_command(),
       default_model: "claude-opus-4-6",
       models: models
     }}
  end
end
