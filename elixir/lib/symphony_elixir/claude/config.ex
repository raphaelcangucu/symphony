defmodule SymphonyElixir.Claude.Config do
  @moduledoc """
  Claude-specific configuration read from the `claude:` YAML section.
  """

  @behaviour SymphonyElixir.AgentConfig

  @spec command() :: String.t()
  def command do
    case section_value("command") do
      value when is_binary(value) and value != "" -> String.trim(value)
      _ -> SymphonyElixir.InstanceConfig.claude_command()
    end
  end

  @doc "Resolves the exact command string used for a Claude production turn."
  @spec resolve_command(keyword()) :: String.t()
  def resolve_command(opts \\ []) when is_list(opts) do
    case Keyword.get(opts, :claude_command) || Keyword.get(opts, :command) do
      value when is_binary(value) and value != "" -> String.trim(value)
      _ -> command()
    end
  end

  @doc "Reads Claude's version through the same shell command semantics as turns."
  @spec read_version(String.t()) :: String.t() | nil
  def read_version(command) when is_binary(command) do
    read_version(command, nil)
  end

  @spec read_version(String.t(), Path.t() | nil) :: String.t() | nil
  def read_version(command, workspace)
      when is_binary(command) and (is_binary(workspace) or is_nil(workspace)) do
    cmd_opts =
      [stderr_to_stdout: true]
      |> maybe_put_cd(workspace)

    with bash when is_binary(bash) <- System.find_executable("bash"),
         {output, 0} <-
           System.cmd(bash, ["-lc", "#{String.trim(command)} --version"], cmd_opts) do
      output
      |> String.split("\n", trim: true)
      |> List.first()
    else
      _ -> nil
    end
  rescue
    _ -> nil
  end

  defp maybe_put_cd(opts, workspace) when is_binary(workspace), do: Keyword.put(opts, :cd, workspace)
  defp maybe_put_cd(opts, _workspace), do: opts

  @impl SymphonyElixir.AgentConfig
  def validate! do
    if byte_size(String.trim(command())) > 0 do
      :ok
    else
      {:error, "Claude command missing — set claude.command in WORKFLOW.md"}
    end
  end

  defp section_value(key) do
    Map.get(SymphonyElixir.Config.section("claude"), key)
  end
end
