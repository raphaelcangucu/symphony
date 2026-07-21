defmodule SymphonyElixir.Branding do
  @moduledoc """
  Product-facing brand identity (display name, titles, static asset paths).

  Process-level settings live under `Application.get_env(:symphony_elixir, :branding)`
  and optional `SYMPHONY_BRAND_*` env vars (see `config/runtime.exs`). Internal OTP
  app names, modules, and package identifiers stay on the Symphony technical names.
  """

  @default_product_name "Dev10x"
  @default_tracker_title "Dev10x"
  @default_cli_product_name "Dev10x"
  @default_icon_path "dev10x_icon.png"
  @default_favicon_path "favicon.png"
  @default_logo_color_path "dev10x_logo_color.png"
  @default_logo_black_path "dev10x_logo_black.png"
  @default_logo_white_path "dev10x_logo_white.png"

  @type branding_map :: %{
          optional(:product_name) => String.t(),
          optional(:tracker_title) => String.t(),
          optional(:cli_product_name) => String.t(),
          optional(:icon_path) => String.t(),
          optional(:favicon_path) => String.t(),
          optional(:logo_color_path) => String.t(),
          optional(:logo_black_path) => String.t(),
          optional(:logo_white_path) => String.t()
        }

  @spec product_name() :: String.t()
  def product_name, do: string_field(:product_name, @default_product_name)

  @spec tracker_title() :: String.t()
  def tracker_title, do: string_field(:tracker_title, @default_tracker_title)

  @spec cli_product_name() :: String.t()
  def cli_product_name, do: string_field(:cli_product_name, @default_cli_product_name)

  @spec icon_path() :: String.t()
  def icon_path, do: asset_field(:icon_path, @default_icon_path)

  @spec favicon_path() :: String.t()
  def favicon_path, do: asset_field(:favicon_path, @default_favicon_path)

  @spec logo_color_path() :: String.t()
  def logo_color_path, do: asset_field(:logo_color_path, @default_logo_color_path)

  @spec logo_black_path() :: String.t()
  def logo_black_path, do: asset_field(:logo_black_path, @default_logo_black_path)

  @spec logo_white_path() :: String.t()
  def logo_white_path, do: asset_field(:logo_white_path, @default_logo_white_path)

  @spec to_public_map() :: %{String.t() => String.t()}
  def to_public_map do
    %{
      "productName" => product_name(),
      "trackerTitle" => tracker_title(),
      "iconPath" => icon_path(),
      "faviconPath" => favicon_path(),
      "logoColorPath" => logo_color_path(),
      "logoBlackPath" => logo_black_path(),
      "logoWhitePath" => logo_white_path()
    }
  end

  @doc """
  Rewrites tracker SPA HTML so `<title>`, favicon `href`, and
  `window.__SYMPHONY_BRANDING__` reflect the current brand config.
  """
  @spec inject_into_html(binary()) :: binary()
  def inject_into_html(html) when is_binary(html) do
    title = tracker_title()
    favicon = favicon_path()
    payload = Jason.encode!(to_public_map())

    html
    |> replace_title(title)
    |> replace_favicon_href(favicon)
    |> ensure_branding_script(payload)
  end

  defp string_field(key, default) do
    case Map.get(branding_config(), key) do
      value when is_binary(value) ->
        trimmed = String.trim(value)
        if trimmed == "", do: default, else: trimmed

      _ ->
        default
    end
  end

  defp asset_field(key, default) do
    case Map.get(branding_config(), key) do
      value when is_binary(value) ->
        if safe_asset_path?(value), do: value, else: default

      _ ->
        default
    end
  end

  defp branding_config do
    case Application.get_env(:symphony_elixir, :branding) do
      map when is_map(map) ->
        Map.new(map, fn
          {key, value} when is_atom(key) -> {key, value}
          _ -> {:__ignored__, nil}
        end)
        |> Map.delete(:__ignored__)

      _ ->
        %{}
    end
  end

  defp safe_asset_path?(path) when is_binary(path) do
    trimmed = String.trim(path)

    trimmed != "" and
      not String.contains?(trimmed, ["..", "\\", "\0"]) and
      not String.starts_with?(trimmed, "/") and
      not String.contains?(trimmed, "/") and
      Regex.match?(~r/\A[A-Za-z0-9._-]+\z/, trimmed)
  end

  defp replace_title(html, title) do
    escaped = Plug.HTML.html_escape(title)

    cond do
      Regex.match?(~r/<title>.*?<\/title>/is, html) ->
        Regex.replace(~r/<title>.*?<\/title>/is, html, "<title>#{escaped}</title>", global: false)

      Regex.match?(~r/<\/head>/i, html) ->
        String.replace(html, ~r/<\/head>/i, "    <title>#{escaped}</title>\n  </head>", global: false)

      true ->
        html <> "\n<title>#{escaped}</title>\n"
    end
  end

  defp replace_favicon_href(html, favicon) do
    escaped = Plug.HTML.html_escape(favicon)

    updated =
      Regex.replace(
        ~r/(<link\b[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["'])([^"']+)(["'])/i,
        html,
        fn _, prefix, href, suffix ->
          prefix <> rewrite_asset_href(href, escaped) <> suffix
        end,
        global: false
      )

    if updated != html do
      updated
    else
      Regex.replace(
        ~r/(<link\b[^>]*href=["'])([^"']+)(["'][^>]*rel=["'](?:icon|shortcut icon)["'])/i,
        html,
        fn _, prefix, href, suffix ->
          prefix <> rewrite_asset_href(href, escaped) <> suffix
        end,
        global: false
      )
    end
  end

  defp rewrite_asset_href(href, filename) when is_binary(href) and is_binary(filename) do
    case Path.dirname(href) do
      "." -> filename
      "/" -> "/" <> filename
      dir -> Path.join(dir, filename)
    end
  end

  defp ensure_branding_script(html, payload) when is_binary(payload) do
    script =
      "<script>window.__SYMPHONY_BRANDING__=#{payload};</script>"

    html
    |> String.replace(~r/<script>\s*window\.__SYMPHONY_BRANDING__\s*=[\s\S]*?<\/script>\s*/i, "")
    |> then(fn cleaned ->
      if Regex.match?(~r/<\/head>/i, cleaned) do
        String.replace(cleaned, ~r/<\/head>/i, "    #{script}\n  </head>", global: false)
      else
        cleaned <> "\n" <> script <> "\n"
      end
    end)
  end
end
