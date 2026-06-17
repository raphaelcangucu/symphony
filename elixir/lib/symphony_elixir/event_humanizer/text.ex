defmodule SymphonyElixir.EventHumanizer.Text do
  @moduledoc false

  alias Gettext
  alias SymphonyElixirWeb.Gettext, as: GettextBackend

  @domain "events"

  @spec t(String.t()) :: String.t()
  def t(msgid) when is_binary(msgid), do: Gettext.dgettext(GettextBackend, @domain, msgid)

  @spec t(String.t(), map()) :: String.t()
  def t(msgid, bindings) when is_binary(msgid),
    do: Gettext.dgettext(GettextBackend, @domain, msgid, bindings)
end
