defmodule SymphonyElixir.Tracker.Workpad do
  @moduledoc """
  Single source of truth for workpad comment classification. A workpad is the
  issue comment whose body starts with `Codex Workpad` (any heading level);
  exactly one should exist per issue and it is edited in place.
  """

  @workpad_pattern ~r/^\s*#*\s*Codex Workpad/i

  @spec classify(String.t() | nil) :: String.t()
  def classify(body) when is_binary(body) do
    if Regex.match?(@workpad_pattern, body), do: "workpad", else: "comment"
  end

  def classify(_body), do: "comment"

  @spec workpad?(String.t() | nil) :: boolean()
  def workpad?(body), do: classify(body) == "workpad"
end
