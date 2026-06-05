defmodule SymphonyElixir.AgentRouting do
  @moduledoc """
  Resolves coding-agent backend from GitHub issue labels.

  Labels:
  - `symphony:codex` → Codex
  - `symphony:claude` → Claude
  - `symphony` → workflow default agent (Codex when both or only Codex are configured)
  """

  @symphony_label "symphony"
  @label_codex "symphony:codex"
  @label_claude "symphony:claude"

  @agent_labels [@label_codex, @label_claude]

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

  @spec resolve_agent_kind([String.t()], [String.t()], String.t()) :: String.t() | nil
  def resolve_agent_kind(label_names, configured_kinds, default_kind)
      when is_list(label_names) and is_list(configured_kinds) and is_binary(default_kind) do
    normalized = label_names |> Enum.map(&normalize_label/1) |> Enum.reject(&(&1 == ""))

    kind =
      cond do
        @label_claude in normalized -> "claude"
        @label_codex in normalized -> "codex"
        @symphony_label in normalized -> default_kind
        true -> nil
      end

    if kind in configured_kinds, do: kind, else: nil
  end

  @spec routable?([String.t()], [String.t()], String.t()) :: boolean()
  def routable?(label_names, configured_kinds, default_kind) do
    resolve_agent_kind(label_names, configured_kinds, default_kind) != nil
  end

  @doc "Explicit per-task agent from labels (`symphony:codex|claude`); plain `symphony` is no preference."
  @spec label_agent_kind([String.t()]) :: String.t() | nil
  def label_agent_kind(label_names) when is_list(label_names) do
    normalized = label_names |> Enum.map(&normalize_label/1) |> Enum.reject(&(&1 == ""))

    cond do
      @label_claude in normalized -> "claude"
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
