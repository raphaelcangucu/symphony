defmodule SymphonyElixir.DevServer.RunSpec do
  @moduledoc false

  defmodule Command do
    @moduledoc false
    @enforce_keys [:argv]
    defstruct argv: [], exists: nil
  end

  defmodule HealthProbe do
    @moduledoc false
    defstruct path: nil, host_header: nil, exists: nil
  end

  defmodule Health do
    @moduledoc false
    defstruct path: "/",
              host_header: nil,
              timeout_ms: 120_000,
              interval_ms: 1_000,
              also: []
  end

  defmodule Stop do
    @moduledoc false
    defstruct signal: "TERM", command: nil, grace_ms: 5_000
  end

  @enforce_keys [:start, :health, :stop]
  defstruct cwd: nil,
            prepare: [],
            start: [],
            health: nil,
            stop: nil,
            warmup: false

  @type command :: %Command{argv: [String.t()], exists: String.t() | nil}

  @type t :: %__MODULE__{
          cwd: String.t() | nil,
          prepare: [command()],
          start: [command()],
          health: %Health{},
          stop: %Stop{},
          warmup: boolean()
        }

  @spec_file "run-spec.json"

  @default_health_timeout_ms 120_000
  @default_health_interval_ms 1_000
  @default_stop_signal "TERM"
  @default_stop_grace_ms 5_000

  # Mirrors SHELL_CONTROL_PATTERN in priv/preview/run.sh. Both sides must agree,
  # otherwise a spec accepted at save/prepare time explodes only at start time.
  @shell_control_pattern ~r/[;&|<>`\r\n]|\$\(/
  @shell_interpreters ~w(bash sh)
  @shell_script_flags ~w(-c -lc)

  @spec normalize(map(), keyword()) :: {:ok, t()} | {:error, atom()}
  def normalize(map, opts) when is_map(map) and is_list(opts) do
    port = Keyword.fetch!(opts, :port)
    preview_env = preview_env(opts)

    with {:ok, prepare} <- normalize_commands(fetch(map, :prepare), port, preview_env),
         {:ok, start} <- normalize_start(fetch(map, :start), port, preview_env),
         {:ok, health} <- normalize_health(fetch(map, :health)),
         {:ok, stop} <- normalize_stop(fetch(map, :stop)) do
      {:ok,
       %__MODULE__{
         cwd: to_optional_str(fetch(map, :cwd)),
         prepare: prepare,
         start: start,
         health: health,
         stop: stop,
         warmup: to_bool(fetch(map, :warmup), false)
       }}
    end
  end

  @spec to_json!(t()) :: binary()
  def to_json!(%__MODULE__{} = spec), do: Jason.encode!(to_map(spec))

  @spec write_temp!(t(), Path.t()) :: Path.t()
  def write_temp!(%__MODULE__{} = spec, dir) when is_binary(dir) do
    File.mkdir_p!(dir)
    path = Path.join(dir, @spec_file)
    tmp = path <> ".tmp.#{System.unique_integer([:positive])}"
    File.write!(tmp, to_json!(spec))
    File.rename!(tmp, path)
    path
  end

  @spec to_map(t()) :: map()
  def to_map(%__MODULE__{} = spec) do
    %{
      "cwd" => spec.cwd,
      "prepare" => Enum.map(spec.prepare, &command_to_map/1),
      "start" => Enum.map(spec.start, &command_to_map/1),
      "health" => health_to_map(spec.health),
      "stop" => stop_to_map(spec.stop),
      "warmup" => spec.warmup
    }
  end

  defp normalize_start(nil, _port, _preview_env), do: {:error, :missing_start}
  defp normalize_start([], _port, _preview_env), do: {:error, :missing_start}

  defp normalize_start(entries, port, preview_env) when is_list(entries) do
    normalize_commands(entries, port, preview_env)
  end

  defp normalize_start(_entries, _port, _preview_env), do: {:error, :missing_start}

  defp normalize_commands(nil, _port, _preview_env), do: {:ok, []}

  defp normalize_commands(entries, port, preview_env) when is_list(entries) do
    entries
    |> Enum.reduce_while({:ok, []}, fn entry, {:ok, acc} ->
      case normalize_command(entry, port, preview_env) do
        {:ok, command} -> {:cont, {:ok, [command | acc]}}
        {:error, _} = error -> {:halt, error}
      end
    end)
    |> case do
      {:ok, commands} -> {:ok, Enum.reverse(commands)}
      {:error, _} = error -> error
    end
  end

  defp normalize_commands(_entries, _port, _preview_env), do: {:error, :invalid_commands}

  defp normalize_command(%{} = entry, port, preview_env) do
    exists = to_optional_str(fetch(entry, :exists))
    run = fetch(entry, :run)

    cond do
      is_nil(exists) or is_nil(run) ->
        {:error, :invalid_command}

      true ->
        with {:ok, argv} <- normalize_argv(run, port, preview_env) do
          {:ok, %Command{argv: argv, exists: exists}}
        end
    end
  end

  defp normalize_command(argv, port, preview_env) when is_list(argv) do
    with {:ok, normalized_argv} <- normalize_argv(argv, port, preview_env) do
      {:ok, %Command{argv: normalized_argv, exists: nil}}
    end
  end

  defp normalize_command(_entry, _port, _preview_env), do: {:error, :invalid_command}

  defp normalize_argv(argv, port, preview_env) when is_list(argv) do
    shell_script_index = shell_script_index(argv)

    argv
    |> Enum.with_index()
    |> Enum.reduce_while({:ok, []}, fn {part, index}, {:ok, acc} ->
      case normalize_argv_part(part, port, preview_env) do
        {:ok, normalized} ->
          if index != shell_script_index and Regex.match?(@shell_control_pattern, normalized) do
            {:halt, {:error, :rejected_shell_metacharacters}}
          else
            {:cont, {:ok, [normalized | acc]}}
          end

        {:error, _} = error ->
          {:halt, error}
      end
    end)
    |> case do
      {:ok, parts} -> {:ok, Enum.reverse(parts)}
      {:error, _} = error -> error
    end
  end

  defp normalize_argv(_argv, _port, _preview_env), do: {:error, :invalid_argv}

  # Index of the script argument in an explicit shell command
  # (["bash"|"sh", "-c"|"-lc", script, ...]). That argument may legitimately
  # contain shell metacharacters; the runner applies the same exemption.
  defp shell_script_index([interpreter, flag, script | _rest])
       when is_binary(interpreter) and is_binary(script) do
    if Path.basename(interpreter) in @shell_interpreters and flag in @shell_script_flags do
      2
    end
  end

  defp shell_script_index(_argv), do: nil

  defp normalize_argv_part(value, port, preview_env) when is_binary(value) do
    {:ok, expand_substitutions(value, port, preview_env)}
  end

  defp normalize_argv_part(value, _port, _preview_env) when is_integer(value) do
    {:ok, Integer.to_string(value)}
  end

  defp normalize_argv_part(_value, _port, _preview_env), do: {:error, :invalid_argv}

  defp expand_substitutions(value, port, preview_env) do
    value
    |> String.replace("${PORT}", Integer.to_string(port))
    |> expand_preview_env(preview_env)
  end

  defp expand_preview_env(value, preview_env) do
    Enum.reduce(preview_env, value, fn {name, env_value}, acc ->
      String.replace(acc, "${#{name}}", env_value)
    end)
  end

  defp normalize_health(nil) do
    {:ok, %Health{}}
  end

  defp normalize_health(%{} = health) do
    with {:ok, also} <- normalize_health_also(fetch(health, :also)) do
      {:ok,
       %Health{
         path: to_str(fetch(health, :path)) || "/",
         host_header: to_optional_str(fetch(health, :host_header)),
         timeout_ms: to_int(fetch(health, :timeout_ms), @default_health_timeout_ms),
         interval_ms: to_int(fetch(health, :interval_ms), @default_health_interval_ms),
         also: also
       }}
    end
  end

  defp normalize_health(_health), do: {:error, :invalid_health}

  defp normalize_health_also(nil), do: {:ok, []}

  defp normalize_health_also(entries) when is_list(entries) do
    entries
    |> Enum.reduce_while({:ok, []}, fn entry, {:ok, acc} ->
      case normalize_health_probe(entry) do
        {:ok, probe} -> {:cont, {:ok, [probe | acc]}}
        {:error, _} = error -> {:halt, error}
      end
    end)
    |> case do
      {:ok, probes} -> {:ok, Enum.reverse(probes)}
      {:error, _} = error -> error
    end
  end

  defp normalize_health_also(_entries), do: {:error, :invalid_health_also}

  defp normalize_health_probe(%{} = probe) do
    path = to_str(fetch(probe, :path))

    if is_nil(path) do
      {:error, :invalid_health_probe}
    else
      {:ok,
       %HealthProbe{
         path: path,
         host_header: to_optional_str(fetch(probe, :host_header)),
         exists: to_optional_str(fetch(probe, :exists))
       }}
    end
  end

  defp normalize_health_probe(_probe), do: {:error, :invalid_health_probe}

  defp normalize_stop(nil) do
    {:ok, %Stop{}}
  end

  defp normalize_stop(%{} = stop) do
    case normalize_stop_command(fetch(stop, :command)) do
      {:error, _} = error ->
        error

      command ->
        {:ok,
         %Stop{
           signal: to_str(fetch(stop, :signal)) || @default_stop_signal,
           command: command,
           grace_ms: to_int(fetch(stop, :grace_ms), @default_stop_grace_ms)
         }}
    end
  end

  defp normalize_stop(_stop), do: {:error, :invalid_stop}

  defp normalize_stop_command(nil), do: nil

  defp normalize_stop_command(argv) when is_list(argv) do
    argv
    |> Enum.reduce_while([], fn part, acc ->
      case part do
        part when is_binary(part) -> {:cont, [part | acc]}
        part when is_integer(part) -> {:cont, [Integer.to_string(part) | acc]}
        _other -> {:halt, :invalid}
      end
    end)
    |> case do
      :invalid -> nil
      parts -> parts |> Enum.reverse() |> validate_stop_command_safety()
    end
  end

  defp normalize_stop_command(_command), do: nil

  # The runner re-normalizes the stop command at teardown time with the same
  # metacharacter rule; rejecting here keeps a bad stop command from silently
  # degrading teardown to a bare signal.
  defp validate_stop_command_safety(argv) do
    shell_script_index = shell_script_index(argv)

    rejected? =
      argv
      |> Enum.with_index()
      |> Enum.any?(fn {part, index} ->
        index != shell_script_index and Regex.match?(@shell_control_pattern, part)
      end)

    if rejected?, do: {:error, :rejected_shell_metacharacters}, else: argv
  end

  defp command_to_map(%Command{} = command) do
    base = %{"argv" => command.argv}

    case command.exists do
      nil -> base
      exists -> Map.put(base, "exists", exists)
    end
  end

  defp health_to_map(%Health{} = health) do
    %{
      "path" => health.path,
      "host_header" => health.host_header,
      "timeout_ms" => health.timeout_ms,
      "interval_ms" => health.interval_ms,
      "also" => Enum.map(health.also, &health_probe_to_map/1)
    }
  end

  defp health_probe_to_map(%HealthProbe{} = probe) do
    base = %{
      "path" => probe.path,
      "host_header" => probe.host_header
    }

    case probe.exists do
      nil -> base
      exists -> Map.put(base, "exists", exists)
    end
  end

  defp stop_to_map(%Stop{} = stop) do
    %{
      "signal" => stop.signal,
      "command" => stop.command,
      "grace_ms" => stop.grace_ms
    }
  end

  defp preview_env(opts) do
    opts
    |> Keyword.get(:preview_env, %{})
    |> Map.new(fn
      {key, value} when is_binary(key) and is_binary(value) ->
        {key, value}

      {key, value} when is_atom(key) and is_binary(value) ->
        {Atom.to_string(key), value}
    end)
    |> then(fn explicit ->
      System.get_env()
      |> Enum.filter(fn {name, _value} -> String.starts_with?(name, "SYMPHONY_PREVIEW_") end)
      |> Map.new()
      |> Map.merge(explicit)
    end)
  end

  defp fetch(map, key) do
    case Map.fetch(map, key) do
      {:ok, value} ->
        value

      :error ->
        case Map.fetch(map, Atom.to_string(key)) do
          {:ok, value} -> value
          :error -> nil
        end
    end
  end

  defp to_optional_str(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp to_optional_str(_value), do: nil

  defp to_str(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp to_str(_value), do: nil

  defp to_int(value, _default) when is_integer(value), do: value

  defp to_int(value, default) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {int, _rest} -> int
      :error -> default
    end
  end

  defp to_int(_value, default), do: default

  defp to_bool(value, _default) when is_boolean(value), do: value
  defp to_bool("true", _default), do: true
  defp to_bool("false", _default), do: false
  defp to_bool(_value, default), do: default
end
