defmodule SymphonyElixir.Cursor.ModelCatalog do
  @moduledoc """
  Static Cursor Agent model catalog, shaped exactly like
  `SymphonyElixir.Codex.ModelCatalog.catalog()`. Mirrors the model slugs the
  `cursor-agent` CLI accepts through `--model`.

  The CLI has no reasoning-effort flag, so every model exposes `efforts: []`
  and the composer hides the effort menu. `auto` delegates model selection to
  the CLI itself (the runner omits `--model` for it).
  """

  alias SymphonyElixir.InstanceConfig

  @default_model "auto"

  @models [
    %{id: "auto", label: "Auto", default: true},
    %{id: "composer-1", label: "Composer 1", default: false},
    %{id: "gpt-5", label: "GPT-5", default: false},
    %{id: "sonnet-4", label: "Claude Sonnet 4", default: false},
    %{id: "sonnet-4-thinking", label: "Claude Sonnet 4 Thinking", default: false}
  ]

  @spec list_models(keyword()) :: {:ok, map()}
  def list_models(_opts \\ []) do
    {:ok,
     %{
       agent: "cursor",
       agent_label: "Cursor Agent",
       command: InstanceConfig.cursor_command(),
       default_model: @default_model,
       models: Enum.map(@models, &present_model/1)
     }}
  end

  defp present_model(model) do
    %{
      id: model.id,
      model: model.id,
      label: model.label,
      is_default: model.default,
      default_effort: "",
      efforts: [],
      input_modalities: ["text", "image"]
    }
  end
end
