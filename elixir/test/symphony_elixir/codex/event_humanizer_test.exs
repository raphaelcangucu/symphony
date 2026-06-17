defmodule SymphonyElixir.Codex.EventHumanizerTest do
  use ExUnit.Case, async: true

  alias Gettext
  alias SymphonyElixir.Codex.EventHumanizer
  alias SymphonyElixirWeb.Gettext, as: GettextBackend

  setup do
    Gettext.put_locale(GettextBackend, "en")
    :ok
  end

  test "humanizes turn/cancelled in English" do
    assert EventHumanizer.humanize_method("turn/cancelled", %{}) == "turn cancelled"
  end

  test "humanizes turn/cancelled in Portuguese" do
    Gettext.put_locale(GettextBackend, "pt_BR")
    assert EventHumanizer.humanize_method("turn/cancelled", %{}) == "turn cancelado"
  end

  test "humanizes tool input request with question" do
    payload = %{"params" => %{"question" => "Continue?"}}

    assert EventHumanizer.humanize_method("item/tool/requestUserInput", payload) ==
             "tool requires user input: Continue?"
  end
end
