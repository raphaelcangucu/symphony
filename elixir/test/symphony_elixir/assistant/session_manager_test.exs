defmodule SymphonyElixir.Assistant.SessionManagerTest do
  use ExUnit.Case, async: true

  alias Gettext
  alias SymphonyElixir.Assistant.SessionManager
  alias SymphonyElixirWeb.Gettext, as: GettextBackend

  setup do
    Gettext.put_locale(GettextBackend, "en")
    :ok
  end

  test "greeting reply is English by default" do
    assert {:ok, %{assistant_message: msg}} = SessionManager.handle_message("proj", "hello")
    assert msg =~ "project's context"
  end

  test "greeting reply is Portuguese when locale is pt_BR" do
    Gettext.put_locale(GettextBackend, "pt_BR")
    assert {:ok, %{assistant_message: msg}} = SessionManager.handle_message("proj", "oi")
    assert msg =~ "contexto deste projeto"
  end
end
