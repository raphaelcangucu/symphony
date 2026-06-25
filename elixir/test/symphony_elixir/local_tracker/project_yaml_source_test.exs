defmodule SymphonyElixir.LocalTracker.ProjectYamlSourceTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.ProjectYamlSource

  setup do
    previous = Application.get_env(:symphony_elixir, :project_yaml_http_get)
    on_exit(fn -> Application.put_env(:symphony_elixir, :project_yaml_http_get, previous) end)
    :ok
  end

  test "rejects non-https urls" do
    assert {:error, :invalid_import_url} = ProjectYamlSource.fetch("http://example.com/gamba.yaml")
  end

  test "blocks localhost targets" do
    assert {:error, :import_url_blocked} = ProjectYamlSource.fetch("https://localhost/gamba.yaml")
  end

  test "fetches yaml over https" do
    Application.put_env(:symphony_elixir, :project_yaml_http_get, fn _url ->
      {:ok, "kind: symphony_project\nslug: gamba\n"}
    end)

    assert {:ok, body} = ProjectYamlSource.fetch("https://example.com/gamba.yaml")
    assert body =~ "symphony_project"
  end

  test "rejects oversized responses" do
    Application.put_env(:symphony_elixir, :project_yaml_http_get, fn _url ->
      {:error, :import_url_too_large}
    end)

    assert {:error, :import_url_too_large} =
             ProjectYamlSource.fetch("https://example.com/gamba.yaml")
  end
end
