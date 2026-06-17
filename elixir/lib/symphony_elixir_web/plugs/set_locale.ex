defmodule SymphonyElixirWeb.Plugs.SetLocale do
  @moduledoc "Sets Gettext locale from the tracker's X-Symphony-Locale header."

  import Plug.Conn

  alias Gettext, as: GettextCore
  alias SymphonyElixirWeb.Gettext, as: GettextBackend

  @default "en"
  @supported %{"en" => "en", "pt-BR" => "pt_BR", "pt-br" => "pt_BR", "pt_BR" => "pt_BR"}

  @spec init(keyword()) :: keyword()
  def init(opts), do: opts

  @spec call(Plug.Conn.t(), keyword()) :: Plug.Conn.t()
  def call(conn, _opts) do
    locale =
      conn
      |> get_req_header("x-symphony-locale")
      |> List.first()
      |> normalize_locale()

    GettextCore.put_locale(GettextBackend, locale)
    conn
  end

  defp normalize_locale(nil), do: @default
  defp normalize_locale(header), do: Map.get(@supported, header, @default)
end
