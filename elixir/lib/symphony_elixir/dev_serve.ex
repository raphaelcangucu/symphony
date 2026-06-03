defmodule SymphonyElixir.DevServe do
  @moduledoc """
  Pure boot-input resolution for the local `make serve` script (`dev/serve.exs`).

  Global-less orchestration boots with process settings only, so a workflow file
  is **optional**. This module isolates the (testable) decision of whether a
  workflow file should be loaded for backward compatibility and how the HTTP port
  override is parsed, keeping the boot script thin.
  """

  @default_workflow "WORKFLOW.md"
  @port_env "SYMPHONY_TRACKER_PORT"
  @workflow_env "SYMPHONY_WORKFLOW"

  @typedoc "Outcome of resolving the optional workflow source."
  @type workflow_source :: {:ok, Path.t()} | {:missing, Path.t()} | :none

  @doc """
  Resolves the optional workflow source from CLI `argv` and environment `env`.

  Resolution order:

    1. An explicit path (first CLI arg, else `#{@workflow_env}`) → `{:ok, path}`
       when it exists, `{:missing, path}` when it does not (still a hard error so
       a typo is not silently ignored).
    2. No explicit path but a default `#{@default_workflow}` present → `{:ok, path}`
       (backward compatibility with the legacy single-workflow boot).
    3. Otherwise → `:none`; the app boots with process settings only.

  `exists?` is injectable for testing; it defaults to `File.regular?/1`.
  """
  @spec resolve_workflow_source([String.t()], %{optional(String.t()) => String.t()}, (Path.t() ->
                                                                                        boolean())) ::
          workflow_source()
  def resolve_workflow_source(argv, env, exists? \\ &File.regular?/1)
      when is_list(argv) and is_map(env) and is_function(exists?, 1) do
    case explicit_workflow_path(argv, env) do
      {:ok, path} ->
        if exists?.(path), do: {:ok, path}, else: {:missing, path}

      :none ->
        default = Path.expand(@default_workflow)
        if exists?.(default), do: {:ok, default}, else: :none
    end
  end

  @doc """
  Parses the optional HTTP port override from the environment.

  Returns `{:ok, nil}` when unset, `{:ok, port}` for a valid non-negative integer,
  or `{:error, message}` for an invalid value.
  """
  @spec resolve_port(%{optional(String.t()) => String.t()}) ::
          {:ok, non_neg_integer() | nil} | {:error, String.t()}
  def resolve_port(env) when is_map(env) do
    case Map.get(env, @port_env) do
      nil ->
        {:ok, nil}

      value when is_binary(value) ->
        case Integer.parse(String.trim(value)) do
          {port, ""} when port >= 0 -> {:ok, port}
          _ -> {:error, "Invalid #{@port_env}: #{inspect(value)}"}
        end
    end
  end

  defp explicit_workflow_path([path | _], _env) when is_binary(path) and path != "" do
    {:ok, Path.expand(path)}
  end

  defp explicit_workflow_path(_argv, env) do
    case Map.get(env, @workflow_env) do
      value when is_binary(value) and value != "" -> {:ok, Path.expand(value)}
      _ -> :none
    end
  end
end
