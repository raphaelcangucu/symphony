defmodule SymphonyElixir.Agent.CLI do
  @moduledoc """
  Command-line interface for the standalone multi-provider agent client.
  """

  alias SymphonyElixir.Agent.{BackendCapabilities, Client, Error}

  @switches [
    agent: :string,
    workspace: :string,
    prompt: :string,
    conversation: :string,
    model: :string,
    effort: :string,
    mode: :string,
    text: :boolean,
    help: :boolean
  ]
  @aliases [a: :agent, w: :workspace, p: :prompt, h: :help]
  @modes ~w(plan build yolo)

  @type deps :: %{
          client_execute: (Client.operation(), keyword() -> {:ok, map()} | {:error, map()}),
          providers: (-> [String.t()]),
          capabilities: (String.t() -> BackendCapabilities.t())
        }

  @spec main([String.t()]) :: no_return()
  def main(args) do
    case evaluate(args) do
      {:ok, payload, :json} ->
        IO.puts(Jason.encode!(payload))
        System.halt(0)

      {:ok, text, :text} ->
        IO.puts(text)
        System.halt(0)

      {:error, message} ->
        IO.puts(:stderr, message)
        System.halt(1)
    end
  end

  @spec evaluate([String.t()], deps()) ::
          {:ok, map() | String.t(), :json | :text} | {:error, String.t()}
  def evaluate(args, deps \\ runtime_deps())

  def evaluate(["providers" | rest], deps) do
    with {:ok, _opts, positionals} <- parse(rest),
         :ok <- no_positionals(positionals) do
      {:ok, %{command: "providers", providers: deps.providers.()}, :json}
    end
  end

  def evaluate(["capabilities" | rest], deps) do
    with {:ok, opts, positionals} <- parse(rest),
         :ok <- no_positionals(positionals),
         {:ok, provider} <- optional_provider(opts, deps.providers.()) do
      capabilities =
        case provider do
          nil -> Enum.map(deps.providers.(), &capability_map(deps, &1))
          selected -> capability_map(deps, selected)
        end

      {:ok, %{command: "capabilities", capabilities: capabilities}, :json}
    end
  end

  def evaluate([command | rest], deps) when command in ["run", "steer", "goal"] do
    operation = operation(command)

    with {:ok, opts, positionals} <- parse(rest),
         {:ok, provider} <- required_provider(opts, deps.providers.()),
         {:ok, prompt} <- prompt(opts, positionals),
         :ok <- validate_mode(Keyword.get(opts, :mode)),
         {:ok, result} <-
           deps.client_execute.(
             operation,
             provider: provider,
             workspace: opts |> Keyword.get(:workspace, File.cwd!()) |> Path.expand(),
             prompt: prompt,
             conversation_id: Keyword.get(opts, :conversation),
             model: Keyword.get(opts, :model),
             effort: Keyword.get(opts, :effort),
             execution_mode: Keyword.get(opts, :mode)
           ) do
      if Keyword.get(opts, :text, false) do
        {:ok, Map.get(result, :assistant_message) || Map.get(result, "assistant_message") || "", :text}
      else
        {:ok, %{command: command, result: result}, :json}
      end
    else
      {:error, error} when is_map(error) ->
        encoded_error(error)

      {:error, message} ->
        {:error, message}
    end
  end

  def evaluate(["help" | _rest], _deps), do: {:ok, usage_message(), :text}
  def evaluate(["--help" | _rest], _deps), do: {:ok, usage_message(), :text}
  def evaluate([], _deps), do: {:ok, usage_message(), :text}
  def evaluate(_args, _deps), do: encoded_error(:unknown_agent_command)

  @spec usage_message() :: String.t()
  def usage_message do
    """
    Usage: symphony agent <command> [options]

    Commands:
      providers
      capabilities [--agent codex|claude|cursor]
      run --agent codex|claude|cursor [--workspace PATH] --prompt TEXT
      steer --agent codex|claude|cursor --conversation ID --prompt TEXT
      goal --agent codex|claude|cursor [--conversation ID] --prompt TEXT

    Shared execution options:
      --conversation ID   Resume the selected provider conversation
      --model MODEL       Select a provider model
      --effort EFFORT     Select reasoning effort when supported
      --mode MODE         plan, build, or yolo
      --text              Print only the assistant response (JSON is the default)

    A prompt may also be supplied positionally after the options.
    """
    |> String.trim()
  end

  defp parse(args) do
    case OptionParser.parse(args, strict: @switches, aliases: @aliases) do
      {opts, positionals, []} ->
        if Keyword.get(opts, :help, false),
          do: encoded_error(:invalid_cli_arguments),
          else: {:ok, opts, positionals}

      _ ->
        encoded_error(:invalid_cli_arguments)
    end
  end

  defp optional_provider(opts, providers) do
    case Keyword.get(opts, :agent) do
      nil -> {:ok, nil}
      provider -> validate_provider(provider, providers)
    end
  end

  defp required_provider(opts, providers) do
    opts
    |> Keyword.get(:agent, "codex")
    |> validate_provider(providers)
  end

  defp validate_provider(provider, providers) do
    provider = provider |> to_string() |> String.downcase()

    if provider in providers,
      do: {:ok, provider},
      else: encoded_error({:unsupported_provider, provider})
  end

  defp prompt(opts, positionals) do
    explicit = Keyword.get(opts, :prompt)

    cond do
      is_binary(explicit) and String.trim(explicit) != "" and positionals == [] ->
        {:ok, String.trim(explicit)}

      is_nil(explicit) and positionals != [] ->
        {:ok, Enum.join(positionals, " ")}

      true ->
        encoded_error(:prompt_required)
    end
  end

  defp validate_mode(nil), do: :ok
  defp validate_mode(mode) when mode in @modes, do: :ok
  defp validate_mode(mode), do: encoded_error({:invalid_execution_mode, mode})

  defp no_positionals([]), do: :ok
  defp no_positionals(_positionals), do: encoded_error(:invalid_cli_arguments)

  defp encoded_error(reason), do: {:error, Jason.encode!(%{error: Error.to_map(reason)})}

  defp operation("run"), do: :run
  defp operation("steer"), do: :steer
  defp operation("goal"), do: :goal

  defp capability_map(deps, provider) do
    provider
    |> deps.capabilities.()
    |> BackendCapabilities.to_map()
  end

  defp runtime_deps do
    %{
      client_execute: &Client.execute/2,
      providers: &Client.providers/0,
      capabilities: &Client.capabilities/1
    }
  end
end
