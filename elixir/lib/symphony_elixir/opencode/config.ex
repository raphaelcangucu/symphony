defmodule SymphonyElixir.OpenCode.Config do
  @moduledoc """
  OpenCode-specific configuration read from the `opencode:` YAML section.
  """

  @behaviour SymphonyElixir.AgentConfig

  @spec command() :: String.t()
  def command do
    case section_value("command") do
      value when is_binary(value) and value != "" -> String.trim(value)
      _ -> SymphonyElixir.InstanceConfig.opencode_command()
    end
  end

  @impl SymphonyElixir.AgentConfig
  def validate! do
    if byte_size(String.trim(command())) > 0 do
      :ok
    else
      {:error, "OpenCode command missing — set opencode.command in WORKFLOW.md"}
    end
  end

  defp section_value(key) do
    Map.get(SymphonyElixir.Config.section("opencode"), key)
  end
end
