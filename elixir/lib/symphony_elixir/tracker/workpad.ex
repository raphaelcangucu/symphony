defmodule SymphonyElixir.Tracker.Workpad do
  @moduledoc """
  Single source of truth for special comment classification. A workpad is the
  issue comment whose body starts with `Codex Workpad` (any heading level);
  an evidence comment starts with `Codex Evidence`. Exactly one of each should
  exist per issue and both are edited in place.
  """

  @workpad_pattern ~r/^\s*#*\s*Codex Workpad/i
  @evidence_pattern ~r/^\s*#*\s*Codex Evidence/i

  @spec classify(String.t() | nil) :: String.t()
  def classify(body) when is_binary(body) do
    cond do
      Regex.match?(@workpad_pattern, body) -> "workpad"
      Regex.match?(@evidence_pattern, body) -> "evidence"
      true -> "comment"
    end
  end

  def classify(_body), do: "comment"

  @spec workpad?(String.t() | nil) :: boolean()
  def workpad?(body), do: classify(body) == "workpad"

  @spec evidence?(String.t() | nil) :: boolean()
  def evidence?(body), do: classify(body) == "evidence"
end
