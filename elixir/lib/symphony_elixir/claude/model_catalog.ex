defmodule SymphonyElixir.Claude.ModelCatalog do
  @moduledoc """
  Static Claude Code model catalog, shaped exactly like
  `SymphonyElixir.Codex.ModelCatalog.catalog()`. Mirrors the models and
  reasoning efforts the `claude` CLI exposes through `--model` / `--effort`.

  Reasoning effort is GA in Claude Code (`--effort low|medium|high|xhigh|max`):
  `max` is flagship-tier only (Opus / Fable), `xhigh` reaches the Opus 4.7+ and
  Sonnet 5 tiers, and Haiku has no effort control — so Haiku keeps
  `efforts == []` and the composer hides the menu for it. Because the CLI exposes
  no model-listing command, the catalog is curated by hand: each model carries an
  explicit `default_effort` (the rung Claude Code itself pre-selects) rather than
  an inferred one, since Sonnet 5 supports `xhigh` yet still defaults to `high`.
  """

  alias SymphonyElixir.Claude.Config, as: ClaudeConfig

  @default_model "claude-opus-5"

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
  @sonnet_next_efforts ~w(low medium high xhigh)

  @models [
    %{id: "claude-opus-5", label: "Claude Opus 5", default: true, efforts: @opus_efforts, default_effort: "xhigh"},
    %{id: "claude-fable-5", label: "Claude Fable 5", default: false, efforts: @opus_efforts, default_effort: "xhigh"},
    %{id: "claude-opus-4-8", label: "Claude Opus 4.8", default: false, efforts: @opus_efforts, default_effort: "xhigh"},
    %{id: "claude-opus-4-7", label: "Claude Opus 4.7", default: false, efforts: @opus_efforts, default_effort: "xhigh"},
    %{id: "claude-opus-4-6", label: "Claude Opus 4.6", default: false, efforts: @opus_legacy_efforts, default_effort: "high"},
    %{id: "claude-sonnet-5", label: "Claude Sonnet 5", default: false, efforts: @sonnet_next_efforts, default_effort: "high"},
    %{id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", default: false, efforts: @sonnet_efforts, default_effort: "high"},
    %{id: "claude-haiku-4-5", label: "Claude Haiku 4.5", default: false, efforts: [], default_effort: ""}
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
      default_effort: model.default_effort,
      efforts: Enum.map(model.efforts, &effort_option/1),
      input_modalities: ["text", "image"]
    }
  end

  defp effort_option(id), do: %{id: id, label: Map.fetch!(@effort_labels, id)}
end
