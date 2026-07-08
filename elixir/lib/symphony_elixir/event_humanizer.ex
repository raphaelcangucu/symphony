defmodule SymphonyElixir.EventHumanizer do
  @moduledoc """
  Behaviour for humanizing agent event messages in the status dashboard.

  Each coding agent backend (Codex, Claude) emits different event names and
  payload structures. Implementations translate raw payloads into short,
  human-readable strings for the dashboard.
  """

  alias SymphonyElixir.Config

  alias Gettext, as: GettextCore
  alias SymphonyElixir.Settings.Ui
  alias SymphonyElixirWeb.Gettext, as: GettextBackend

  @callback humanize_method(method :: String.t(), payload :: map()) :: String.t()

  @spec adapter() :: module()
  def adapter do
    case Config.agent_kind() do
      "codex" -> SymphonyElixir.Codex.EventHumanizer
      "claude" -> SymphonyElixir.Claude.EventHumanizer
      # Cursor and OpenCode CLI runners emit the Claude-style bridge vocabulary
      # (item/created, turn/completed, ...), so they share its humanizer.
      "cursor" -> SymphonyElixir.Claude.EventHumanizer
      "opencode" -> SymphonyElixir.Claude.EventHumanizer
      _ -> SymphonyElixir.Claude.EventHumanizer
    end
  end

  @spec humanize_method(String.t(), map()) :: String.t()
  def humanize_method(method, payload) do
    GettextCore.put_locale(GettextBackend, Ui.effective_gettext_locale())
    adapter().humanize_method(method, payload)
  end
end
