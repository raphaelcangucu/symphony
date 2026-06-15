defmodule SymphonyElixir.Cursor.ModelCatalog do
  @moduledoc """
  Cursor Agent model catalog, shaped exactly like
  `SymphonyElixir.Codex.ModelCatalog.catalog()`.

  Models are discovered at runtime from `cursor-agent --list-models` so the
  catalog tracks whatever the installed CLI accepts via `--model`, instead of a
  hand-maintained list that drifts behind new releases. When the CLI is missing,
  errors, or reports no parseable models, we fall back to a small static
  catalog so the picker always offers at least `auto`.

  The CLI has no reasoning-effort flag, so every model exposes `efforts: []`
  and the composer hides the effort menu. `auto` delegates model selection to
  the CLI itself (the runner omits `--model` for it).

  ### `--list-models` output shape

      Available models

      auto - Auto
      composer-2.5 - Composer 2.5 (current)
      gpt-5.5-high - GPT-5.5 1M High

  Each model line is `<slug> - <label>`; the header and blank lines are ignored.
  """

  require Logger

  alias SymphonyElixir.InstanceConfig

  @default_model "auto"

  @fallback_models [
    %{id: "auto", label: "Auto", default: true},
    %{id: "composer-1", label: "Composer 1", default: false},
    %{id: "gpt-5", label: "GPT-5", default: false},
    %{id: "sonnet-4", label: "Claude Sonnet 4", default: false},
    %{id: "sonnet-4-thinking", label: "Claude Sonnet 4 Thinking", default: false}
  ]

  @type model_option :: %{
          id: String.t(),
          model: String.t(),
          label: String.t(),
          is_default: boolean(),
          default_effort: String.t(),
          efforts: [],
          input_modalities: [String.t()]
        }

  @type catalog :: %{
          agent: String.t(),
          agent_label: String.t(),
          command: String.t(),
          default_model: String.t(),
          models: [model_option()]
        }

  @spec list_models(keyword()) :: {:ok, catalog()}
  def list_models(opts \\ []) do
    list_models_fun = Keyword.get(opts, :list_models_fun, &run_list_models/0)

    models =
      case fetch_cli_models(list_models_fun) do
        {:ok, [_ | _] = parsed} -> parsed
        _ -> @fallback_models
      end

    {:ok,
     %{
       agent: "cursor",
       agent_label: "Cursor Agent",
       command: InstanceConfig.cursor_command(),
       default_model: @default_model,
       models: Enum.map(models, &present_model/1)
     }}
  end

  defp fetch_cli_models(list_models_fun) do
    case safe_invoke(list_models_fun) do
      {output, 0} when is_binary(output) ->
        {:ok, parse_models(output)}

      {_output, status} ->
        Logger.warning("Cursor ModelCatalog: --list-models exited with status #{inspect(status)}")
        :error
    end
  end

  defp safe_invoke(list_models_fun) do
    list_models_fun.()
  rescue
    error ->
      Logger.warning("Cursor ModelCatalog: --list-models raised #{Exception.message(error)}")
      {"", 1}
  end

  defp run_list_models do
    [command | base_args] = String.split(InstanceConfig.cursor_command(), " ", trim: true)

    System.cmd(command, base_args ++ ["--list-models"],
      stderr_to_stdout: true,
      env: []
    )
  rescue
    _ -> {"", 1}
  catch
    :exit, _ -> {"", 1}
  end

  @model_line ~r/\A(?<slug>[A-Za-z0-9._-]+)\s+-\s+(?<label>.+?)\s*\z/

  defp parse_models(output) do
    output
    |> String.split("\n", trim: true)
    |> Enum.flat_map(&parse_line/1)
  end

  defp parse_line(line) do
    case Regex.named_captures(@model_line, line) do
      %{"slug" => slug, "label" => label} ->
        [%{id: slug, label: label, default: slug == @default_model}]

      _ ->
        []
    end
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
