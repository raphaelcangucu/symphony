defmodule SymphonyElixir.Assistant.ObservabilityToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.ObservabilityTools

  test "tool_specs exposes list_observability_runtimes" do
    names = ObservabilityTools.tool_specs() |> Enum.map(& &1["name"])
    assert "list_observability_runtimes" in names
  end

  test "returns the registry aggregate" do
    assert {:ok, %{tool: "list_observability_runtimes", data: %{runtimes: runtimes}}} =
             ObservabilityTools.execute("list_observability_runtimes", %{})

    assert is_list(runtimes)
  end

  test "rejects unsupported tools" do
    assert {:error, {:unsupported_tool, "nope"}} = ObservabilityTools.execute("nope", %{})
  end
end
