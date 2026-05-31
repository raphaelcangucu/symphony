defmodule SymphonyElixir.Codex.ModelCatalog do
  @moduledoc """
  Fetches available models and reasoning efforts from the Codex app-server (`model/list`).
  """

  alias SymphonyElixir.Codex.Config
  alias SymphonyElixir.Config, as: SymphonyConfig

  @initialize_id 1
  @model_list_id 4
  @port_line_bytes 1_048_576
  @cache_ttl_ms 10 * 60 * 1_000
  @version Mix.Project.config()[:version]

  @fallback_efforts [
    %{id: "low", label: "Low"},
    %{id: "medium", label: "Medium"},
    %{id: "high", label: "High"},
    %{id: "xhigh", label: "Extra high"}
  ]

  @type effort_option :: %{
          required(:id) => String.t(),
          required(:label) => String.t(),
          optional(:description) => String.t()
        }

  @type model_option :: %{
          required(:id) => String.t(),
          required(:model) => String.t(),
          required(:label) => String.t(),
          required(:is_default) => boolean(),
          required(:default_effort) => String.t(),
          required(:efforts) => [effort_option()],
          optional(:description) => String.t(),
          optional(:input_modalities) => [String.t()]
        }

  @type catalog :: %{
          required(:agent) => String.t(),
          required(:agent_label) => String.t(),
          required(:command) => String.t(),
          required(:default_model) => String.t() | nil,
          required(:models) => [model_option()]
        }

  @spec list_models(keyword()) :: {:ok, catalog()} | {:error, term()}
  def list_models(opts \\ []) do
    case Application.get_env(:symphony_elixir, :assistant_codex_catalog) do
      catalog when is_map(catalog) ->
        {:ok, catalog}

      _ ->
        list_models_cached(opts)
    end
  end

  defp list_models_cached(opts) do
    case read_cache() do
      {:ok, catalog, cached_at} ->
        maybe_refresh_cache_async(opts, cached_at)
        {:ok, catalog}

      :error ->
        refresh_cache_async(opts)
        {:ok, fallback_catalog()}
    end
  end

  defp list_models_from_cli(opts) do
    workspace = Keyword.get(opts, :workspace, default_workspace())

    with :ok <- ensure_workspace(workspace),
         {:ok, port} <- start_port(workspace) do
      try do
        with :ok <- handshake(port),
             {:ok, models} <- fetch_models(port) do
          {:ok, present_catalog(models)}
        end
      after
        stop_port(port)
      end
    end
  end

  @spec default_workspace() :: Path.t()
  def default_workspace do
    Path.join([SymphonyConfig.workspace_root(), "assistant", "_model-catalog"])
  end

  defp present_catalog(models) when is_list(models) do
    options = Enum.map(models, &present_model/1)
    default = Enum.find(options, & &1.is_default) || List.first(options)

    %{
      agent: "codex",
      agent_label: "Codex CLI",
      command: Config.command(),
      default_model: default && default.model,
      models: options
    }
  end

  defp fallback_catalog do
    %{
      agent: "codex",
      agent_label: "Codex CLI",
      command: Config.command(),
      default_model: "gpt-5.5",
      models: [
        fallback_model("gpt-5.5", "GPT-5.5", true),
        fallback_model("gpt-5.4", "GPT-5.4", false),
        fallback_model("gpt-5.3-codex", "GPT-5.3 Codex", false)
      ]
    }
  end

  defp fallback_model(model, label, default?) do
    %{
      id: model,
      model: model,
      label: label,
      is_default: default?,
      default_effort: "medium",
      efforts: @fallback_efforts,
      input_modalities: ["text", "image"]
    }
  end

  defp present_model(model) when is_map(model) do
    model_id = pick_string(model, ["model", "id"]) || ""
    efforts = present_efforts(Map.get(model, "supportedReasoningEfforts", []))
    default_effort = pick_string(model, ["defaultReasoningEffort"]) || default_effort_id(efforts)

    %{
      id: pick_string(model, ["id"]) || model_id,
      model: model_id,
      label: pick_string(model, ["displayName"]) || model_id,
      description: pick_string(model, ["description"]),
      is_default: Map.get(model, "isDefault") == true,
      default_effort: default_effort,
      efforts: efforts,
      input_modalities: List.wrap(Map.get(model, "inputModalities"))
    }
  end

  defp present_efforts(efforts) when is_list(efforts) do
    efforts
    |> Enum.flat_map(fn
      %{"reasoningEffort" => effort} = option ->
        [
          %{
            id: effort,
            label: effort_label(effort),
            description: pick_string(option, ["description"])
          }
        ]

      _ ->
        []
    end)
    |> Enum.uniq_by(& &1.id)
  end

  defp present_efforts(_), do: []

  defp default_effort_id(efforts) do
    case List.first(efforts) do
      %{id: id} -> id
      _ -> "medium"
    end
  end

  defp effort_label("xhigh"), do: "Extra high"
  defp effort_label("none"), do: "None"
  defp effort_label(value) when is_binary(value), do: String.capitalize(value)
  defp effort_label(_), do: "Medium"

  defp handshake(port) do
    send_json(port, %{
      "method" => "initialize",
      "id" => @initialize_id,
      "params" => %{
        "capabilities" => %{"experimentalApi" => true},
        "clientInfo" => %{
          "name" => "symphony-tracker",
          "title" => "Symphony Tracker",
          "version" => @version
        }
      }
    })

    with {:ok, _} <- await_response(port, @initialize_id, SymphonyConfig.agent_read_timeout_ms()) do
      send_json(port, %{"method" => "initialized", "params" => %{}})
      :ok
    end
  end

  defp fetch_models(port) do
    send_json(port, %{
      "method" => "model/list",
      "id" => @model_list_id,
      "params" => %{"includeHidden" => false}
    })

    case await_response(port, @model_list_id, SymphonyConfig.agent_read_timeout_ms()) do
      {:ok, %{"data" => data}} when is_list(data) -> {:ok, data}
      {:ok, result} -> {:error, {:invalid_model_list, result}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp maybe_refresh_cache_async(opts, cached_at) do
    if now_ms() - cached_at > @cache_ttl_ms do
      refresh_cache_async(opts)
    end
  end

  defp refresh_cache_async(opts) do
    Task.start(fn ->
      case list_models_from_cli(opts) do
        {:ok, catalog} -> write_cache(catalog)
        {:error, _reason} -> :ok
      end
    end)

    :ok
  end

  defp cache_file do
    Path.join(default_workspace(), "model_catalog.json")
  end

  defp read_cache do
    with {:ok, body} <- File.read(cache_file()),
         {:ok, %{"catalog" => catalog, "cached_at" => cached_at}} <- Jason.decode(body),
         cached_at when is_integer(cached_at) <- cached_at,
         {:ok, normalized} <- normalize_cached_catalog(catalog) do
      {:ok, normalized, cached_at}
    else
      _ -> :error
    end
  end

  defp write_cache(catalog) when is_map(catalog) do
    file = cache_file()

    with :ok <- File.mkdir_p(Path.dirname(file)) do
      File.write(file, Jason.encode!(%{cached_at: now_ms(), catalog: catalog}))
    end
  end

  defp normalize_cached_catalog(%{} = catalog) do
    models =
      catalog
      |> map_get("models", :models, [])
      |> List.wrap()
      |> Enum.map(&normalize_cached_model/1)
      |> Enum.reject(&(&1.model == ""))

    if models == [] do
      :error
    else
      {:ok,
       %{
         agent: map_get(catalog, "agent", :agent, "codex"),
         agent_label: map_get(catalog, "agent_label", :agent_label, "Codex CLI"),
         command: map_get(catalog, "command", :command, Config.command()),
         default_model: map_get(catalog, "default_model", :default_model, nil),
         models: models
       }}
    end
  end

  defp normalize_cached_model(%{} = model) do
    model_id = map_get(model, "model", :model, map_get(model, "id", :id, ""))
    efforts = model |> map_get("efforts", :efforts, @fallback_efforts) |> List.wrap() |> Enum.map(&normalize_cached_effort/1)

    %{
      id: map_get(model, "id", :id, model_id),
      model: model_id,
      label: map_get(model, "label", :label, model_id),
      description: map_get(model, "description", :description, nil),
      is_default: map_get(model, "is_default", :is_default, false),
      default_effort: map_get(model, "default_effort", :default_effort, "medium"),
      efforts: efforts,
      input_modalities: map_get(model, "input_modalities", :input_modalities, ["text", "image"])
    }
  end

  defp normalize_cached_model(_model), do: fallback_model("", "", false)

  defp normalize_cached_effort(%{} = effort) do
    id = map_get(effort, "id", :id, "medium")

    %{
      id: id,
      label: map_get(effort, "label", :label, effort_label(id)),
      description: map_get(effort, "description", :description, nil)
    }
  end

  defp normalize_cached_effort(effort) when is_binary(effort), do: %{id: effort, label: effort_label(effort)}
  defp normalize_cached_effort(_effort), do: %{id: "medium", label: "Medium"}

  defp map_get(map, string_key, atom_key, default) do
    Map.get(map, string_key, Map.get(map, atom_key, default))
  end

  defp now_ms, do: System.system_time(:millisecond)

  defp ensure_workspace(workspace) do
    File.mkdir_p(workspace)
    :ok
  end

  defp start_port(workspace) do
    executable = System.find_executable("bash")

    if is_nil(executable) do
      {:error, :bash_not_found}
    else
      port =
        Port.open(
          {:spawn_executable, String.to_charlist(executable)},
          [
            :binary,
            :exit_status,
            :stderr_to_stdout,
            args: [~c"-lc", String.to_charlist(Config.command())],
            cd: String.to_charlist(Path.expand(workspace)),
            line: @port_line_bytes
          ]
        )

      {:ok, port}
    end
  end

  defp await_response(port, request_id, timeout_ms, pending_line \\ "") do
    receive do
      {^port, {:data, {:eol, chunk}}} ->
        await_response(port, request_id, timeout_ms, pending_line <> to_string(chunk))

      {^port, {:data, {:noeol, chunk}}} ->
        await_response(port, request_id, timeout_ms, pending_line <> to_string(chunk))

      {^port, {:exit_status, status}} ->
        {:error, {:port_exit, status}}
    after
      timeout_ms ->
        {:error, :response_timeout}
    end
    |> case do
      {:error, _} = error ->
        error

      line when is_binary(line) ->
        handle_response_line(port, request_id, timeout_ms, line)
    end
  end

  defp handle_response_line(port, request_id, timeout_ms, data) do
    case Jason.decode(data) do
      {:ok, %{"id" => ^request_id, "error" => error}} ->
        {:error, {:response_error, error}}

      {:ok, %{"id" => ^request_id, "result" => result}} ->
        {:ok, result}

      {:ok, %{"id" => ^request_id} = response} ->
        {:error, {:response_error, response}}

      {:ok, _other} ->
        await_response(port, request_id, timeout_ms)

      {:error, _} ->
        await_response(port, request_id, timeout_ms)
    end
  end

  defp send_json(port, message) when is_map(message) do
    Port.command(port, Jason.encode!(message) <> "\n")
  end

  defp stop_port(port) when is_port(port) do
    case :erlang.port_info(port) do
      :undefined -> :ok
      _ -> Port.close(port)
    end
  end

  defp pick_string(map, keys) when is_map(map) do
    Enum.find_value(keys, fn
      key when is_binary(key) ->
        case Map.get(map, key) do
          value when is_binary(value) and value != "" -> value
          _ -> nil
        end

      key when is_atom(key) ->
        case Map.get(map, key) || Map.get(map, Atom.to_string(key)) do
          value when is_binary(value) and value != "" -> value
          _ -> nil
        end

      _ ->
        nil
    end)
  end
end
