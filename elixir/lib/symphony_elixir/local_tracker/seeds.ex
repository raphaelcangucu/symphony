defmodule SymphonyElixir.LocalTracker.Seeds do
  @moduledoc "Default local tracker seed data."

  @default_statuses [
    {"Backlog", "backlog", false},
    {"Todo", "active", false},
    {"In Progress", "active", false},
    {"Human Review", "wait", false},
    {"Merging", "active", false},
    {"Rework", "active", false},
    {"Done", "terminal", true}
  ]

  @spec default_statuses() :: [{String.t(), String.t(), boolean()}]
  def default_statuses, do: @default_statuses
end
