defmodule SymphonyElixir.AgentRouting do
  @moduledoc """
  Label-level agent signals for Symphony issues.

  - `label_agent_kind/1`: explicit per-task agent from `symphony:codex` /
    `symphony:claude` / `symphony:cursor` labels; plain `symphony` carries NO
    preference (nil).
  - `routable?/1`: admission check — any `symphony*` label admits the issue.

  Effective-agent resolution (task > project > user default) lives in
  `SymphonyElixir.AgentPreference`.
  """

  @symphony_label "symphony"
  @label_codex "symphony:codex"
  @label_claude "symphony:claude"
  @label_cursor "symphony:cursor"

  @agent_labels [@label_codex, @label_claude, @label_cursor]

  @spec symphony_label() :: String.t()
  def symphony_label, do: @symphony_label

  @spec admission_labels() :: [String.t()]
  def admission_labels, do: [@symphony_label | @agent_labels]

  @spec agent_labels() :: [String.t()]
  def agent_labels, do: @agent_labels

  @spec symphony_label?(String.t()) :: boolean()
  def symphony_label?(label) when is_binary(label) do
    down = String.downcase(String.trim(label))
    down == @symphony_label or down in @agent_labels
  end

  def symphony_label?(_), do: false

  @doc "Explicit per-task agent from labels (`symphony:codex|claude|cursor`); plain `symphony` is no preference."
  @spec label_agent_kind([String.t()]) :: String.t() | nil
  def label_agent_kind(label_names) when is_list(label_names) do
    normalized = label_names |> Enum.map(&normalize_label/1) |> Enum.reject(&(&1 == ""))

    cond do
      @label_claude in normalized -> "claude"
      @label_cursor in normalized -> "cursor"
      @label_codex in normalized -> "codex"
      true -> nil
    end
  end

  @doc "Admission check by labels alone — agent availability no longer gates admission."
  @spec routable?([String.t()]) :: boolean()
  def routable?(label_names) when is_list(label_names) do
    normalized = label_names |> Enum.map(&normalize_label/1)
    Enum.any?(admission_labels(), &(&1 in normalized))
  end

  defp normalize_label(name) when is_binary(name), do: String.downcase(String.trim(name))
  defp normalize_label(_), do: ""
end
