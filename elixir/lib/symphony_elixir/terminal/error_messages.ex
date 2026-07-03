defmodule SymphonyElixir.Terminal.ErrorMessages do
  @moduledoc "Localized user-facing terminal error messages."

  use Gettext, backend: SymphonyElixirWeb.Gettext

  alias Gettext, as: GettextCore
  alias SymphonyElixir.Settings.Ui

  @default_locale "en"

  @spec localize(term(), String.t() | nil) :: String.t()
  def localize(reason, locale \\ nil)

  def localize(:tmux_unavailable, locale) do
    with_locale(locale, fn -> dgettext("errors", "tmux is not available") end)
  end

  def localize(:terminal_tab_not_found, locale) do
    with_locale(locale, fn -> dgettext("errors", "terminal tab not found") end)
  end

  def localize({:workspace_setup_failed, reason}, locale) do
    with_locale(locale, fn ->
      dgettext("errors", "workspace setup failed: %{reason}", reason: format_reason(reason))
    end)
  end

  def localize(message, _locale) when is_binary(message), do: message

  def localize(reason, _locale) when is_atom(reason), do: Atom.to_string(reason)

  def localize(reason, locale), do: with_locale(locale, fn -> inspect(reason) end)

  defp with_locale(nil, fun), do: with_locale(Ui.effective_gettext_locale(), fun)

  defp with_locale(locale, fun) when is_function(fun, 0) do
    GettextCore.with_locale(SymphonyElixirWeb.Gettext, locale || @default_locale, fun)
  end

  defp format_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp format_reason(reason), do: inspect(reason)
end
