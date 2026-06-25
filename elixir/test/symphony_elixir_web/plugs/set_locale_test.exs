defmodule SymphonyElixirWeb.Plugs.SetLocaleTest do
  use ExUnit.Case, async: true

  import Plug.Conn
  import Plug.Test

  alias Gettext
  alias SymphonyElixirWeb.Gettext, as: GettextBackend
  alias SymphonyElixirWeb.Plugs.SetLocale

  test "sets Gettext locale from X-Symphony-Locale header" do
    conn =
      conn(:get, "/", [])
      |> put_req_header("x-symphony-locale", "pt-BR")
      |> SetLocale.call([])

    assert Gettext.get_locale(GettextBackend) == "pt_BR"
    assert conn.state == :unset
  end

  test "falls back to en for unknown locale" do
    _conn =
      conn(:get, "/", [])
      |> put_req_header("x-symphony-locale", "fr")
      |> SetLocale.call([])

    assert Gettext.get_locale(GettextBackend) == "en"
  end

  test "defaults to en when header is absent" do
    _conn = conn(:get, "/", []) |> SetLocale.call([])
    assert Gettext.get_locale(GettextBackend) == "en"
  end
end
