defmodule SymphonyElixir.BrandingTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Branding

  setup do
    previous = Application.get_env(:symphony_elixir, :branding)

    on_exit(fn ->
      restore_branding(previous)
    end)

    :ok
  end

  test "defaults to Dev10x product branding" do
    Application.delete_env(:symphony_elixir, :branding)

    assert Branding.product_name() == "Dev10x"
    assert Branding.tracker_title() == "Dev10x"
    assert Branding.cli_product_name() == "Dev10x"
    assert Branding.icon_path() == "dev10x_icon.png"
    assert Branding.favicon_path() == "favicon.png"
  end

  test "reads branding overrides from application env" do
    Application.put_env(:symphony_elixir, :branding, %{
      product_name: "Acme",
      tracker_title: "Acme Board",
      cli_product_name: "Acme CLI",
      icon_path: "acme_icon.png",
      favicon_path: "acme.svg",
      logo_color_path: "acme_logo_color.png",
      logo_black_path: "acme_logo_black.png",
      logo_white_path: "acme_logo_white.png"
    })

    assert Branding.product_name() == "Acme"
    assert Branding.tracker_title() == "Acme Board"
    assert Branding.cli_product_name() == "Acme CLI"
    assert Branding.icon_path() == "acme_icon.png"
    assert Branding.favicon_path() == "acme.svg"
  end

  test "rejects blank product_name and falls back to default" do
    Application.put_env(:symphony_elixir, :branding, %{product_name: "   "})

    assert Branding.product_name() == "Dev10x"
  end

  test "rejects unsafe asset paths and falls back to defaults" do
    Application.put_env(:symphony_elixir, :branding, %{
      icon_path: "../etc/passwd",
      favicon_path: "/absolute.svg"
    })

    assert Branding.icon_path() == "dev10x_icon.png"
    assert Branding.favicon_path() == "favicon.png"
  end

  test "to_public_map/0 exposes only browser-safe branding fields" do
    Application.put_env(:symphony_elixir, :branding, %{
      product_name: "Acme",
      tracker_title: "Acme Board",
      icon_path: "acme_icon.png",
      favicon_path: "acme.svg"
    })

    assert Branding.to_public_map() == %{
             "productName" => "Acme",
             "trackerTitle" => "Acme Board",
             "iconPath" => "acme_icon.png",
             "faviconPath" => "acme.svg",
             "logoColorPath" => "dev10x_logo_color.png",
             "logoBlackPath" => "dev10x_logo_black.png",
             "logoWhitePath" => "dev10x_logo_white.png"
           }
  end

  test "inject_into_html/1 sets title and window branding bootstrap" do
    Application.put_env(:symphony_elixir, :branding, %{
      product_name: "Acme",
      tracker_title: "Acme Board",
      icon_path: "acme_icon.png",
      favicon_path: "acme.svg"
    })

    html =
      Branding.inject_into_html("""
      <!doctype html>
      <html>
        <head>
          <link rel="icon" href="/favicon.svg" />
          <title>Old Title</title>
        </head>
        <body></body>
      </html>
      """)

    assert html =~ "<title>Acme Board</title>"
    assert html =~ ~s(window.__SYMPHONY_BRANDING__)
    assert html =~ ~s("productName":"Acme")
    assert html =~ ~s(href="/acme.svg")
    refute html =~ "<title>Old Title</title>"
  end

  defp restore_branding(nil), do: Application.delete_env(:symphony_elixir, :branding)
  defp restore_branding(value), do: Application.put_env(:symphony_elixir, :branding, value)
end
