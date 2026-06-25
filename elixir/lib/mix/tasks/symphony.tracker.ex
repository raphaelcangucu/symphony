defmodule Mix.Tasks.Symphony.Tracker do
  @shortdoc "Run tracker tools from the shell against the running Symphony daemon"
  @moduledoc """
  Thin CLI over the same assistant tools the chat assistant uses. Connects to the
  running Symphony daemon over distributed Erlang (start it with `make serve` first)
  so the tracker SQLite database keeps a single owner.

      mix symphony.tracker projects
      mix symphony.tracker issues <slug> [--search TEXT]
      mix symphony.tracker issue <slug> <identifier>
      mix symphony.tracker move <slug> <identifier> <status>
      mix symphony.tracker comment <slug> <identifier> <body>
      mix symphony.tracker comments <slug> <identifier>
      mix symphony.tracker dispatch <slug> <identifier> --instructions TEXT [--agent codex]
      mix symphony.tracker running [slug]
      mix symphony.tracker steer <slug> <identifier> <message>
      mix symphony.tracker sync <slug> <identifier>
      mix symphony.tracker evidence <slug> <identifier>
      mix symphony.tracker handoff <slug> <identifier>
      mix symphony.tracker orchestrator <slug> <identifier>
      mix symphony.tracker dispatch-explain <slug> <identifier>
      mix symphony.tracker pr-link <slug> <identifier> <url>
      mix symphony.tracker preview <slug> <identifier> [status|start|stop|restart]
      mix symphony.tracker dev-env <slug> <action> [--step-id ID] [--category CAT]
      mix symphony.tracker blockers <slug> <identifier>
      mix symphony.tracker blockers-add <slug> <identifier> <target>
      mix symphony.tracker blockers-rm <slug> <identifier> <target>

  Add `--json` to print the full structured `{tool, message, data}` as one JSON line.
  """

  use Mix.Task

  @switches [
    search: :string,
    instructions: :string,
    agent: :string,
    step_id: :string,
    category: :string,
    json: :boolean
  ]

  # {command, tool, slug_mode, [positional_arg_keys], %{static args}}
  # slug_mode: true (required) | false (none) | :optional (first positional, may be omitted)
  @commands [
    {"projects", "list_tracker_projects", false, [], %{}},
    {"issues", "list_issues", true, [], %{}},
    {"issue", "get_issue", true, ["identifier"], %{}},
    {"move", "move_issue", true, ["identifier", "status"], %{}},
    {"comment", "add_comment", true, ["identifier", "body"], %{}},
    {"comments", "list_comments", true, ["identifier"], %{}},
    {"dispatch", "dispatch_coding_agent", true, ["identifier"], %{}},
    {"running", "list_running_agents", :optional, [], %{}},
    {"steer", "steer_agent", true, ["identifier", "message"], %{}},
    {"sync", "sync_issue", true, ["identifier"], %{}},
    {"evidence", "get_evidence_status", true, ["identifier"], %{}},
    {"handoff", "check_handoff_gate", true, ["identifier"], %{}},
    {"orchestrator", "get_issue_orchestrator_state", true, ["identifier"], %{}},
    {"dispatch-explain", "explain_dispatch_eligibility", true, ["identifier"], %{}},
    {"pr-link", "link_pull_request", true, ["identifier", "url"], %{}},
    {"preview", "manage_preview", true, ["identifier", "action"], %{"action" => "status"}},
    {"dev-env", "manage_dev_env", true, ["action"], %{}},
    {"blockers", "manage_blockers", true, ["identifier"], %{"action" => "list"}},
    {"blockers-add", "manage_blockers", true, ["identifier", "target"], %{"action" => "create"}},
    {"blockers-rm", "manage_blockers", true, ["identifier", "target"], %{"action" => "delete"}}
  ]

  @impl true
  def run(argv) do
    case build(argv) do
      {:ok, tool, slug, args, opts} -> dispatch(tool, slug, args, opts)
      {:error, reason} -> Mix.raise(error_message(reason))
    end
  end

  @doc false
  @spec build([String.t()]) ::
          {:ok, String.t(), String.t() | nil, map(), keyword()} | {:error, term()}
  def build([command | rest]) do
    case Enum.find(@commands, fn {name, _tool, _slug?, _keys, _static} -> name == command end) do
      nil ->
        {:error, {:unknown_command, command}}

      {_name, tool, needs_slug?, positional_keys, static} ->
        {parsed, positionals, _invalid} = OptionParser.parse(rest, switches: @switches)
        build_command(command, tool, needs_slug?, positional_keys, static, positionals, parsed)
    end
  end

  def build([]), do: {:error, :no_command}

  defp build_command(command, tool, needs_slug?, positional_keys, static, positionals, parsed) do
    {slug, value_args} = split_slug(needs_slug?, positionals)
    required_count = Enum.count(positional_keys, &(not Map.has_key?(static, &1)))

    cond do
      needs_slug? == true and is_nil(slug) ->
        {:error, {:missing_args, command}}

      length(value_args) < required_count ->
        {:error, {:missing_args, command}}

      true ->
        positional_map =
          positional_keys
          |> Enum.zip(value_args)
          |> Map.new()

        args =
          static
          |> Map.merge(positional_map)
          |> Map.merge(switch_args(parsed))

        {:ok, tool, slug, args, [json: Keyword.get(parsed, :json, false)]}
    end
  end

  defp split_slug(false, positionals), do: {nil, positionals}
  defp split_slug(true, [slug | rest]), do: {slug, rest}
  defp split_slug(true, []), do: {nil, []}
  defp split_slug(:optional, [slug | rest]), do: {slug, rest}
  defp split_slug(:optional, []), do: {nil, []}

  defp switch_args(parsed) do
    parsed
    |> Keyword.delete(:json)
    |> Enum.reduce(%{}, fn {key, value}, acc -> Map.put(acc, switch_key(key), value) end)
  end

  defp switch_key(:step_id), do: "step_id"
  defp switch_key(:category), do: "category_filter"
  defp switch_key(key), do: Atom.to_string(key)

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
      Mix.shell().info(Jason.encode!(result))
    else
      Mix.shell().info(result[:message] || result["message"] || "")
      data = result[:data] || result["data"] || %{}
      Mix.shell().info(Jason.encode!(data, pretty: true))
    end
  end

  # --- daemon connection (mirrors Mix.Tasks.Symphony.Ctl.on_daemon/1) ---

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
      cli_node = :"symphony_tracker_cli_#{:erlang.unique_integer([:positive])}@127.0.0.1"
      {:ok, _} = Node.start(cli_node, :longnames)
    end

    :ok
  end

  defp error_message({:unknown_command, command}),
    do: "unknown command #{inspect(command)} (see `mix help symphony.tracker`)"

  defp error_message({:missing_args, command}),
    do: "missing arguments for #{inspect(command)} (see `mix help symphony.tracker`)"

  defp error_message(:no_command),
    do: "usage: mix symphony.tracker <command> [args] (see `mix help symphony.tracker`)"

  defp error_message(reason), do: "invalid invocation: #{inspect(reason)}"
end
