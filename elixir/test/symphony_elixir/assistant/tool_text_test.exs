defmodule SymphonyElixir.Assistant.ToolTextTest do
  use ExUnit.Case, async: true

  alias Gettext, as: GettextCore
  alias SymphonyElixir.Assistant.{ToolExecutor, ToolText}
  alias SymphonyElixirWeb.Gettext, as: GettextBackend

  setup do
    on_exit(fn -> GettextCore.put_locale(GettextBackend, "en") end)
    :ok
  end

  test "localizes tool descriptions for pt_BR" do
    GettextCore.put_locale(GettextBackend, "pt_BR")

    spec =
      ToolExecutor.tool_specs()
      |> Enum.find(&(&1["name"] == "create_issue"))

    assert spec["description"] == "Criar uma issue no tracker do projeto atual."
    assert spec["inputSchema"]["properties"]["title"]["description"] == "Título da issue."
  end

  test "localizes bound issue identifiers" do
    GettextCore.put_locale(GettextBackend, "pt_BR")

    spec =
      ToolExecutor.issue_bound_tool_specs("MAC-42")
      |> Enum.find(&(&1["name"] == "move_issue"))

    identifier = spec["inputSchema"]["properties"]["identifier"]
    assert identifier["const"] == "MAC-42"
    assert identifier["description"] == "Identificador da issue vinculado. Deve ser MAC-42."
  end

  test "msg/2 interpolates bindings" do
    GettextCore.put_locale(GettextBackend, "pt_BR")

    assert ToolText.msg("Bound issue workspace for %{identifier}.", %{identifier: "MAC-1"}) ==
             "Workspace da issue vinculada a MAC-1."
  end
end
