defmodule SymphonyElixirWeb.TrackerErrorsTest do
  use ExUnit.Case, async: true

  import Phoenix.ConnTest

  alias Gettext
  alias SymphonyElixirWeb.Gettext, as: GettextBackend
  alias SymphonyElixirWeb.TrackerErrors

  setup do
    Gettext.put_locale(GettextBackend, "en")
    :ok
  end

  test "project_not_found is English by default" do
    conn = build_conn() |> TrackerErrors.render(:project_not_found)

    assert %{"error" => %{"code" => "project_not_found", "message" => "Project not found"}} =
             json_response(conn, 404)
  end

  test "project_not_found is Portuguese when locale is pt_BR" do
    Gettext.put_locale(GettextBackend, "pt_BR")
    conn = build_conn() |> TrackerErrors.render(:project_not_found)
    assert %{"error" => %{"message" => "Projeto não encontrado"}} = json_response(conn, 404)
  end

  test "validation_msg translates dynamic msgids at runtime" do
    conn =
      build_conn()
      |> TrackerErrors.validation_msg("body is required")

    assert %{
             "error" => %{
               "code" => "validation_failed",
               "message" => "body is required",
               "details" => %{}
             }
           } = json_response(conn, 422)
  end

  test "validation_msg respects active Gettext locale for dynamic msgids" do
    Gettext.put_locale(GettextBackend, "pt_BR")

    conn =
      build_conn()
      |> TrackerErrors.validation_msg("body is required")

    assert %{"error" => %{"message" => "body é obrigatório"}} = json_response(conn, 422)
  end

  test "maps kb_invalid_path to 422" do
    conn = build_conn() |> TrackerErrors.render(:kb_invalid_path)
    assert json_response(conn, 422)["error"]["code"] == "kb_invalid_path"
  end

  test "maps kb_page_not_found to 404" do
    conn = build_conn() |> TrackerErrors.render(:kb_page_not_found)
    assert json_response(conn, 404)["error"]["code"] == "kb_page_not_found"
  end

  test "maps kb_frontmatter_invalid to 422" do
    conn = build_conn() |> TrackerErrors.render(:kb_frontmatter_invalid)
    assert json_response(conn, 422)["error"]["code"] == "kb_frontmatter_invalid"
  end

  test "maps kb write/asset errors" do
    assert TrackerErrors.render(build_conn(), :repo_not_checked_out).status == 404
    assert TrackerErrors.render(build_conn(), :kb_unsupported_asset).status == 422
    assert TrackerErrors.render(build_conn(), :kb_asset_too_large).status == 413
    assert TrackerErrors.render(build_conn(), {:kb_commit_failed, "boom"}).status == 500
  end
end
