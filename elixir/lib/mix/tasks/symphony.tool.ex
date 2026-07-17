defmodule Mix.Tasks.Symphony.Tool do
  @shortdoc "List, inspect, or call any Symphony assistant tool by name"
  @moduledoc """
  Generic CLI over the same assistant tools chat/coding agents use. Prefer the
  MCP/dynamic tool when it is exposed in the session; otherwise call from the
  shell against a running daemon (`make serve`).

      mix symphony.tool list [--json]
      mix symphony.tool schema <tool_name> [--json]
      mix symphony.tool call <tool_name> [--project SLUG|-p SLUG] \\
        [--arg key=value ...] [--identifier ID] [--action ACTION] ... [--json]

  `list` and `schema` read tool specs locally (no daemon). `call` connects to the
  Symphony daemon over distributed Erlang and dispatches through
  `SymphonyElixir.Tracker.Cli` → `ToolExecutor` (same path as chat).

  Universal arguments use `--arg key=value`. Values that look like JSON
  (`true`/`false`/`null`/numbers/objects/arrays) are decoded. Common flag
  aliases (`--identifier`, `--action`, `--status`, `--body`, `--server`,
  `--title`, `--instructions`, `--message`, `--url`, `--query`, `--path`,
  `--repository`, `--step-id`, `--category` → `category_filter`) map to the
  same property names.

  Examples:

      mix symphony.tool call manage_preview -p advising \\
        --identifier CDE-1180 --action status --json

      mix symphony.tool call manage_dev_env -p advising \\
        --action list_steps --category serve --json

      mix symphony.tool call list_tracker_projects --json

  See also: `mix symphony.tracker` (friendly subset) and the
  `symphony-tool-cli` agent skill.
  """

  use Mix.Task

  alias SymphonyElixir.Assistant.{DiscoveryTools, ToolExecutor}
  alias SymphonyElixir.Codex.DynamicTool

  @alias_switches [
    project: :string,
    arg: :keep,
    identifier: :string,
    action: :string,
    status: :string,
    body: :string,
    server: :string,
    title: :string,
    instructions: :string,
    message: :string,
    url: :string,
    query: :string,
    path: :string,
    repository: :string,
    step_id: :string,
    category: :string,
    json: :boolean
  ]

  @aliases [p: :project]

  @project_agnostic_tools MapSet.new(
                            DiscoveryTools.tools() ++
                              Enum.map(DynamicTool.tool_specs(), & &1["name"]) ++
                              ["list_running_agents"]
                          )

  @impl true
  def run(argv) do
    case build(argv) do
      {:ok, :list, tools, opts} -> print_list(tools, opts)
      {:ok, :schema, spec, opts} -> print_schema(spec, opts)
      {:ok, :call, tool, slug, args, opts} -> dispatch(tool, slug, args, opts)
      {:error, reason} -> Mix.raise(error_message(reason))
    end
  end

  @doc false
  @spec build([String.t()]) ::
          {:ok, :list, [map()], keyword()}
          | {:ok, :schema, map(), keyword()}
          | {:ok, :call, String.t(), String.t() | nil, map(), keyword()}
          | {:error, term()}
  def build(["list" | rest]) do
    {parsed, _positionals, _invalid} = OptionParser.parse(rest, strict: [json: :boolean], aliases: [])
    {:ok, :list, catalog(), [json: Keyword.get(parsed, :json, false)]}
  end

  def build(["schema", tool_name | rest]) when is_binary(tool_name) do
    {parsed, _positionals, _invalid} = OptionParser.parse(rest, strict: [json: :boolean], aliases: [])

    case find_spec(tool_name) do
      nil -> {:error, {:unknown_tool, tool_name}}
      spec -> {:ok, :schema, spec, [json: Keyword.get(parsed, :json, false)]}
    end
  end

  def build(["schema"]), do: {:error, :missing_tool_name}

  def build(["call", tool_name | rest]) when is_binary(tool_name) do
    {parsed, _positionals, _invalid} =
      OptionParser.parse(rest, strict: @alias_switches, aliases: @aliases)

    args =
      %{}
      |> Map.merge(alias_args(parsed))
      |> Map.merge(parse_arg_keeps(Keyword.get_values(parsed, :arg)))

    slug = normalize_optional_string(Keyword.get(parsed, :project))
    json? = Keyword.get(parsed, :json, false)

    cond do
      is_nil(find_spec(tool_name)) ->
        {:error, {:unknown_tool, tool_name}}

      project_required?(tool_name) and is_nil(slug) ->
        {:error, :project_slug_required}

      true ->
        case missing_required(tool_name, args) do
          [] -> {:ok, :call, tool_name, slug, args, [json: json?]}
          missing -> {:error, {:missing_required, missing}}
        end
    end
  end

  def build(["call"]), do: {:error, :missing_tool_name}
  def build([other | _]), do: {:error, {:unknown_subcommand, other}}
  def build([]), do: {:error, :no_command}

  @doc false
  @spec catalog() :: [map()]
  def catalog do
    (ToolExecutor.tool_specs() ++ DiscoveryTools.tool_specs() ++ DynamicTool.tool_specs())
    |> Enum.uniq_by(& &1["name"])
    |> Enum.sort_by(& &1["name"])
  end

  defp find_spec(name), do: Enum.find(catalog(), &(&1["name"] == name))

  defp project_required?(tool_name), do: not MapSet.member?(@project_agnostic_tools, tool_name)

  defp missing_required(tool_name, args) do
    case find_spec(tool_name) do
      %{"inputSchema" => %{"required" => required}} when is_list(required) ->
        Enum.reject(required, fn key ->
          Map.has_key?(args, key) and not blank?(Map.get(args, key))
        end)

      _ ->
        []
    end
  end

  defp blank?(nil), do: true
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_value), do: false

  defp alias_args(parsed) do
    parsed
    |> Keyword.drop([:json, :arg, :project])
    |> Enum.reduce(%{}, fn {key, value}, acc ->
      Map.put(acc, alias_key(key), value)
    end)
  end

  defp alias_key(:step_id), do: "step_id"
  defp alias_key(:category), do: "category_filter"
  defp alias_key(key), do: Atom.to_string(key)

  defp parse_arg_keeps(values) when is_list(values) do
    Enum.reduce(values, %{}, fn entry, acc ->
      case String.split(entry, "=", parts: 2) do
        [key, raw] -> Map.put(acc, String.trim(key), decode_arg_value(raw))
        _ -> acc
      end
    end)
  end

  defp decode_arg_value(raw) when is_binary(raw) do
    trimmed = String.trim(raw)

    case Jason.decode(trimmed) do
      {:ok, decoded} -> decoded
      {:error, _} -> trimmed
    end
  end

  defp normalize_optional_string(nil), do: nil

  defp normalize_optional_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp print_list(tools, opts) do
    if Keyword.get(opts, :json, false) do
      Mix.shell().info(Jason.encode!(tools))
    else
      Enum.each(tools, fn spec ->
        required =
          case get_in(spec, ["inputSchema", "required"]) do
            list when is_list(list) and list != [] -> "  required: #{Enum.join(list, ", ")}"
            _ -> ""
          end

        Mix.shell().info("#{spec["name"]}\n  #{spec["description"] || ""}\n#{required}")
      end)
    end
  end

  defp print_schema(spec, opts) do
    if Keyword.get(opts, :json, false) do
      Mix.shell().info(Jason.encode!(spec))
    else
      Mix.shell().info(Jason.encode!(spec, pretty: true))
    end
  end

  defp dispatch(tool, slug, args, opts) do
    on_daemon(fn node ->
      case :erpc.call(node, SymphonyElixir.Tracker.Cli, :call, [tool, slug, args]) do
        {:ok, result} -> print_result(result, opts)
        {:error, reason} -> Mix.raise("tool error: #{inspect(reason)}")
      end
    end)
  end

  defp print_result(result, opts) do
    if Keyword.get(opts, :json, false) do
      Mix.shell().info(Jason.encode!(stringify_result(result)))
    else
      Mix.shell().info(result[:message] || result["message"] || "")
      data = result[:data] || result["data"] || %{}
      Mix.shell().info(Jason.encode!(data, pretty: true))
    end
  end

  defp stringify_result(result) when is_map(result) do
    %{
      "tool" => result[:tool] || result["tool"],
      "message" => result[:message] || result["message"],
      "data" => result[:data] || result["data"]
    }
  end

  defp on_daemon(fun) do
    node = String.to_atom(SymphonyElixir.Ctl.node_name())
    ensure_distributed!()
    Node.set_cookie(String.to_atom(SymphonyElixir.Ctl.cookie()))

    case Node.connect(node) do
      true -> fun.(node)
      _ -> Mix.raise("Could not connect to Symphony daemon node #{node}. Run `make serve` first.")
    end
  end

  defp ensure_distributed! do
    if node() == :nonode@nohost do
      cli_node = :"symphony_tool_cli_#{:erlang.unique_integer([:positive])}@127.0.0.1"
      {:ok, _} = Node.start(cli_node, :longnames)
    end

    :ok
  end

  defp error_message({:unknown_subcommand, name}),
    do: "unknown subcommand #{inspect(name)} (see `mix help symphony.tool`)"

  defp error_message({:unknown_tool, name}),
    do: "unknown tool #{inspect(name)} (run `mix symphony.tool list`)"

  defp error_message(:project_slug_required),
    do: "missing --project / -p (required for this tool; see `mix help symphony.tool`)"

  defp error_message({:missing_required, keys}),
    do: "missing required arguments: #{Enum.join(keys, ", ")} (see `mix symphony.tool schema <tool>`)"

  defp error_message(:missing_tool_name),
    do: "missing tool name (see `mix help symphony.tool`)"

  defp error_message(:no_command),
    do: "usage: mix symphony.tool list|schema|call ... (see `mix help symphony.tool`)"

  defp error_message(reason), do: "invalid invocation: #{inspect(reason)}"
end
