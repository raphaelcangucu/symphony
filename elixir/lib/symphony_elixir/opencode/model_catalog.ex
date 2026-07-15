defmodule SymphonyElixir.OpenCode.ModelCatalog do
  @moduledoc """
  OpenCode model catalog, shaped like `SymphonyElixir.Cursor.ModelCatalog.catalog()`.

  Models are discovered at runtime from `opencode models [--refresh]`, which prints
  one `provider/model` id per line (see Jean's `opencode_cli/commands.rs` parser).
  When the CLI is missing or errors, a small static fallback keeps the picker usable.
  """

  require Logger

  alias SymphonyElixir.HotpathCache
  alias SymphonyElixir.InstanceConfig
  alias SymphonyElixir.OpenCode.Config

  @default_model "opencode/gpt-5.5"
  @cache_key :opencode_model_catalog
  @cache_ttl_ms 10 * 60 * 1_000

  @fallback_models [
    %{id: "opencode/gpt-5.5", label: "GPT-5.5 (OpenCode)", default: true},
    %{id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", default: false}
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

  @model_line ~r/\A(?<id>[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)\s*\z/

  @spec list_models(keyword()) :: {:ok, catalog()}
  def list_models(opts \\ []) do
    case Keyword.fetch(opts, :list_models_fun) do
      {:ok, list_models_fun} ->
        {:ok, present_catalog(models_from_fun(list_models_fun))}

      :error ->
        list_models_cached()
    end
  end

  defp list_models_cached do
    case HotpathCache.fetch(@cache_key) do
      {:ok, catalog} ->
        {:ok, catalog}

      :miss ->
        refresh_cache_async()
        {:ok, present_catalog(@fallback_models)}
    end
  end

  defp models_from_fun(list_models_fun) do
    case fetch_cli_models(list_models_fun) do
      {:ok, [_ | _] = parsed} -> parsed
      _ -> @fallback_models
    end
  end

  defp present_catalog(models) do
    %{
      agent: "opencode",
      agent_label: "OpenCode",
      command: Config.command(),
      default_model: @default_model,
      models: Enum.map(models, &present_model/1)
    }
  end

  defp refresh_cache_async do
    Task.start(fn ->
      catalog = present_catalog(models_from_fun(&run_models/0))
      HotpathCache.put(@cache_key, catalog, @cache_ttl_ms)
      SymphonyElixir.Assistant.CatalogBundle.invalidate()
    end)

    :ok
  end

  defp fetch_cli_models(list_models_fun) do
    case safe_invoke(list_models_fun) do
      {output, 0} when is_binary(output) ->
        {:ok, parse_models(output)}

      {_output, status} ->
        Logger.warning("OpenCode ModelCatalog: models exited with status #{inspect(status)}")
        :error
    end
  end

  defp safe_invoke(list_models_fun) do
    list_models_fun.()
  rescue
    error ->
      Logger.warning("OpenCode ModelCatalog: models raised #{Exception.message(error)}")
      {"", 1}
  end

  defp run_models do
    [command | base_args] = String.split(InstanceConfig.opencode_command(), " ", trim: true)

    System.cmd(command, base_args ++ ["models"],
      stderr_to_stdout: true,
      env: []
    )
  rescue
    _ -> {"", 1}
  catch
    :exit, _ -> {"", 1}
  end

  defp parse_models(output) do
    output
    |> String.split("\n", trim: true)
    |> Enum.flat_map(&parse_line/1)
  end

  defp parse_line(line) do
    candidate =
      line
      |> String.trim()
      |> strip_ansi()

    case Regex.named_captures(@model_line, candidate) do
      %{"id" => id} ->
        [%{id: id, label: humanize_model(id), default: id == @default_model}]

      _ ->
        if model_identifier?(candidate) do
          [%{id: candidate, label: humanize_model(candidate), default: candidate == @default_model}]
        else
          []
        end
    end
  end

  defp model_identifier?(value) when is_binary(value) do
    String.contains?(value, "/") and Regex.match?(~r/\A[A-Za-z0-9._\/-]+\z/, value)
  end

  defp model_identifier?(_value), do: false

  defp humanize_model(id) do
    case String.split(id, "/", parts: 2) do
      [_provider, model] -> model |> String.replace("-", " ") |> String.replace("_", " ")
      _ -> id
    end
  end

  defp strip_ansi(text) do
    Regex.replace(~r/\e\[[0-9;]*m/, text, "")
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
