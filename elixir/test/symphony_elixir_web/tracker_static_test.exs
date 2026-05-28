defmodule SymphonyElixirWeb.TrackerStaticTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  @endpoint SymphonyElixirWeb.Endpoint

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    static_root =
      Path.join(System.tmp_dir!(), "symphony-tracker-static-#{System.unique_integer([:positive])}")

    assets_dir = Path.join(static_root, "assets")
    File.mkdir_p!(assets_dir)

    File.write!(
      Path.join(static_root, "index.html"),
      """
      <!doctype html>
      <html>
        <body>
          <div id="root"></div>
          <script type="module" src="/tracker/assets/app.js"></script>
        </body>
      </html>
      """
    )

    File.write!(Path.join(assets_dir, "app.js"), "console.log('tracker fixture');")

    previous_static_root = Application.get_env(:symphony_elixir, :tracker_static_root)
    Application.put_env(:symphony_elixir, :tracker_static_root, static_root)

    on_exit(fn ->
      restore_tracker_static_root(previous_static_root)
      File.rm_rf!(static_root)
    end)

    :ok
  end

  test "serves the tracker SPA index at /tracker" do
    conn = get(build_conn(), "/tracker")

    assert html_response(conn, 200) =~ ~s(<div id="root"></div>)
  end

  test "serves the tracker SPA index for browser-routed tracker paths" do
    conn = get(build_conn(), "/tracker/projects/macro-markets/board")

    assert html_response(conn, 200) =~ ~s(<div id="root"></div>)
  end

  test "serves tracker build assets when the requested file exists" do
    conn = get(build_conn(), "/tracker/assets/app.js")

    assert response(conn, 200) == "console.log('tracker fixture');"
    assert [content_type] = get_resp_header(conn, "content-type")
    assert content_type =~ "javascript"
  end

  test "does not intercept existing dashboard assets or tracker API routes" do
    dashboard_conn = get(build_conn(), "/dashboard.css")
    assert response(dashboard_conn, 200) =~ "body"

    api_conn = get(build_conn(), "/api/tracker/v1/projects")

    assert json_response(api_conn, 401) == %{
             "error" => %{"code" => "unauthorized", "message" => "invalid tracker token"}
           }
  end

  defp restore_tracker_static_root(nil) do
    Application.delete_env(:symphony_elixir, :tracker_static_root)
  end

  defp restore_tracker_static_root(static_root) do
    Application.put_env(:symphony_elixir, :tracker_static_root, static_root)
  end
end
