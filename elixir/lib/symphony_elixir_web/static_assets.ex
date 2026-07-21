defmodule SymphonyElixirWeb.StaticAssets do
  @moduledoc false

  alias SymphonyElixir.Branding

  @dashboard_css_path Path.expand("../../priv/static/dashboard.css", __DIR__)
  @source_tracker_static_root Path.expand("../../priv/static/tracker", __DIR__)
  @phoenix_html_js_path Application.app_dir(:phoenix_html, "priv/static/phoenix_html.js")
  @phoenix_js_path Application.app_dir(:phoenix, "priv/static/phoenix.js")
  @phoenix_live_view_js_path Application.app_dir(:phoenix_live_view, "priv/static/phoenix_live_view.js")

  @external_resource @dashboard_css_path
  @external_resource @phoenix_html_js_path
  @external_resource @phoenix_js_path
  @external_resource @phoenix_live_view_js_path

  @dashboard_css File.read!(@dashboard_css_path)
  @phoenix_html_js File.read!(@phoenix_html_js_path)
  @phoenix_js File.read!(@phoenix_js_path)
  @phoenix_live_view_js File.read!(@phoenix_live_view_js_path)

  @assets %{
    "/dashboard.css" => {"text/css", @dashboard_css},
    "/vendor/phoenix_html/phoenix_html.js" => {"application/javascript", @phoenix_html_js},
    "/vendor/phoenix/phoenix.js" => {"application/javascript", @phoenix_js},
    "/vendor/phoenix_live_view/phoenix_live_view.js" => {"application/javascript", @phoenix_live_view_js}
  }

  @spec fetch(String.t()) :: {:ok, String.t(), binary()} | :error
  def fetch(path) when is_binary(path) do
    case Map.fetch(@assets, path) do
      {:ok, {content_type, body}} -> {:ok, content_type, body}
      :error -> :error
    end
  end

  @spec fetch_tracker_index() :: {:ok, String.t(), binary()} | :error
  def fetch_tracker_index do
    case fetch_tracker_file(["index.html"], "text/html") do
      {:ok, content_type, body} ->
        {:ok, content_type, Branding.inject_into_html(body)}

      :error ->
        :error
    end
  end

  @spec fetch_tracker_asset([String.t()]) :: {:ok, String.t(), binary()} | :error
  def fetch_tracker_asset(path_parts) when is_list(path_parts) do
    fetch_tracker_file(path_parts, nil)
  end

  @spec tracker_static_root() :: Path.t()
  def tracker_static_root do
    Application.get_env(:symphony_elixir, :tracker_static_root) || default_tracker_static_root()
  end

  defp fetch_tracker_file(path_parts, content_type_override) do
    with {:ok, file_path} <- tracker_file_path(path_parts),
         true <- File.regular?(file_path),
         {:ok, body} <- File.read(file_path) do
      content_type = content_type_override || MIME.from_path(file_path) || "application/octet-stream"
      {:ok, content_type, body}
    else
      _ -> :error
    end
  end

  defp tracker_file_path(path_parts) do
    root = Path.expand(tracker_static_root())

    with true <- Enum.all?(path_parts, &safe_tracker_path_part?/1),
         file_path = Path.expand(Path.join([root | path_parts])),
         true <- file_path == root or String.starts_with?(file_path, root <> "/") do
      {:ok, file_path}
    else
      _ -> :error
    end
  end

  defp safe_tracker_path_part?(path_part) when is_binary(path_part) do
    path_part not in ["", ".", ".."] and not String.contains?(path_part, ["\\", "/"])
  end

  defp safe_tracker_path_part?(_path_part), do: false

  defp default_tracker_static_root do
    app_root = Application.app_dir(:symphony_elixir, "priv/static/tracker")
    app_index_path = Path.join(app_root, "index.html")
    source_index_path = Path.join(@source_tracker_static_root, "index.html")

    if File.exists?(app_index_path) or not File.exists?(source_index_path) do
      app_root
    else
      @source_tracker_static_root
    end
  end
end
