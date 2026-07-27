defmodule SymphonyElixir.MobileComparison.Contract do
  @moduledoc """
  Canonical Dev10x comparison matrix launched by the mobile companion.

  Cursor encodes the approved high effort in its model identifier, while Codex
  and Claude carry it as an explicit provider effort.
  """

  @type path :: :session | :orchestrator

  @type cell :: %{
          id: String.t(),
          path: path(),
          provider: String.t(),
          model: String.t(),
          effort: String.t() | nil,
          effective_effort: String.t(),
          title: String.t()
        }

  @cells [
    %{
      id: "session-codex",
      path: :session,
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      effective_effort: "high",
      title: "Session · GPT-5.6 Sol · High"
    },
    %{
      id: "session-cursor",
      path: :session,
      provider: "cursor",
      model: "cursor-grok-4.5-high",
      effort: nil,
      effective_effort: "high",
      title: "Session · Grok 4.5 · High"
    },
    %{
      id: "session-claude",
      path: :session,
      provider: "claude",
      model: "claude-opus-5",
      effort: "high",
      effective_effort: "high",
      title: "Session · Opus 5 · High"
    },
    %{
      id: "orchestrator-codex",
      path: :orchestrator,
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      effective_effort: "high",
      title: "Orchestrator · GPT-5.6 Sol · High"
    },
    %{
      id: "orchestrator-cursor",
      path: :orchestrator,
      provider: "cursor",
      model: "cursor-grok-4.5-high",
      effort: nil,
      effective_effort: "high",
      title: "Orchestrator · Grok 4.5 · High"
    },
    %{
      id: "orchestrator-claude",
      path: :orchestrator,
      provider: "claude",
      model: "claude-opus-5",
      effort: "high",
      effective_effort: "high",
      title: "Orchestrator · Opus 5 · High"
    }
  ]

  @spec cells() :: [cell()]
  def cells, do: @cells

  @spec fetch(String.t()) :: {:ok, cell()} | {:error, :unknown_cell}
  def fetch(id) when is_binary(id) do
    case Enum.find(@cells, &(&1.id == id)) do
      nil -> {:error, :unknown_cell}
      cell -> {:ok, cell}
    end
  end
end
