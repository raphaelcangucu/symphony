defmodule SymphonyElixirWeb.TrackerErrorsTest do
  use ExUnit.Case, async: true

  import Phoenix.ConnTest
  import Plug.Conn

  alias Gettext
  alias SymphonyElixirWeb.Gettext, as: GettextBackend
  alias SymphonyElixirWeb.TrackerErrors

  @endpoint SymphonyElixirWeb.Endpoint

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
end
