defmodule SymphonyElixir.Claude.ModelCatalog do
  @moduledoc """
  Static Claude Code model catalog, shaped exactly like
  `SymphonyElixir.Codex.ModelCatalog.catalog()`. Mirrors the models and
  reasoning efforts the `claude` CLI exposes through `--model` / `--effort`.

  Reasoning effort is GA in Claude Code (`--effort low|medium|high|xhigh|max`):
  `xhigh` lands on Opus 4.7+, `max` is Opus-tier only, and Haiku has no effort
  control — so Haiku keeps `efforts == []` and the composer hides the menu for
  it. Each model pre-selects the rung Claude Code itself defaults to: `xhigh`
  where available (Opus 4.7+), otherwise the GA default `high`.
  """

  alias SymphonyElixir.Claude.Config, as: ClaudeConfig

  @default_model "claude-opus-4-8"

  @effort_labels %{
    "low" => "Low",
    "medium" => "Medium",
    "high" => "High",
    "xhigh" => "Extra high",
    "max" => "Max"
  }

  @opus_efforts ~w(low medium high xhigh max)
  @opus_legacy_efforts ~w(low medium high max)
  @sonnet_efforts ~w(low medium high)

  @models [
    %{id: "claude-opus-4-8", label: "Claude Opus 4.8", default: true, efforts: @opus_efforts},
    %{id: "claude-opus-4-7", label: "Claude Opus 4.7", default: false, efforts: @opus_efforts},
    %{id: "claude-opus-4-6", label: "Claude Opus 4.6", default: false, efforts: @opus_legacy_efforts},
    %{id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", default: false, efforts: @sonnet_efforts},
    %{id: "claude-haiku-4-5", label: "Claude Haiku 4.5", default: false, efforts: []}
  ]

  @spec list_models(keyword()) :: {:ok, map()}
  def list_models(_opts \\ []) do
    {:ok,
     %{
       agent: "claude",
       agent_label: "Claude Code",
       command: ClaudeConfig.resolve_command(),
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
      default_effort: default_effort(model.efforts),
      efforts: Enum.map(model.efforts, &effort_option/1),
      input_modalities: ["text", "image"]
    }
  end

  # Mirror Claude Code's own default rung: xhigh where the model supports it
  # (Opus 4.7+), otherwise the GA default high; no effort control → no default.
  defp default_effort([]), do: ""
  defp default_effort(efforts), do: if("xhigh" in efforts, do: "xhigh", else: "high")

  defp effort_option(id), do: %{id: id, label: Map.fetch!(@effort_labels, id)}
end
