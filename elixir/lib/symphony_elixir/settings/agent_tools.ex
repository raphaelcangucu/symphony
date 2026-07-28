defmodule SymphonyElixir.Settings.AgentTools do
  @moduledoc """
  Composes the per-agent settings payload the Tracker Settings UI renders as
  "CLI" pages (status/source/install/model), mirroring the layout of a
  product-grade agent settings panel.

  It joins three sources:
  - `AgentAvailability` for install status, version, and resolved PATH.
  - `AgentModels` for the curated model catalog and the operator's selection.
  - A small static install-command hint per agent (informational only).
  """

  alias SymphonyElixir.AgentAvailability
  alias SymphonyElixir.Settings.AgentModels

  # Keep atom keys explicit so we never call String.to_atom/1 on user input and
  # the availability lookup stays a compile-time literal.
  @agents [{:codex, "codex"}, {:claude, "claude"}, {:cursor, "cursor"}, {:opencode, "opencode"}]

  @install_commands %{
    "codex" => "npm install -g @openai/codex",
    "claude" => "npm install -g @anthropic-ai/claude-code",
    "cursor" => "curl https://cursor.com/install -fsSL | bash",
    "opencode" => "curl -fsSL https://opencode.ai/install | bash"
  }

  @spec list() :: [map()]
  def list do
    availability = AgentAvailability.probe()

    Enum.map(@agents, fn {atom, name} ->
      present(name, Map.fetch!(availability, atom))
    end)
  end

  defp present(agent, status) do
    %{
      id: agent,
      kind: agent,
      status: %{
        installed: status.available,
        version: status.version,
        path: Map.get(status, :path),
        command: status.command
      },
      source: source(status),
      install: %{
        available: not status.available,
        command: Map.get(@install_commands, agent)
      },
      model: %{
        options: AgentModels.options(agent),
        selected: AgentModels.selected(agent)
      }
    }
  end

  defp source(%{available: true} = status),
    do: %{value: "path", managed: false, detail: Map.get(status, :path)}

  defp source(_status), do: %{value: "none", managed: false, detail: nil}
end
