defmodule SymphonyElixir.Assistant.FreeformKbToolsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.KnowledgeBaseTools
  alias SymphonyElixir.Assistant.ToolExecutor

  test "freeform tool specs expose every knowledge-base tool" do
    freeform_names = ToolExecutor.freeform_tool_specs() |> Enum.map(& &1["name"]) |> MapSet.new()

    for kb_tool <- KnowledgeBaseTools.tools() do
      assert MapSet.member?(freeform_names, kb_tool),
             "expected freeform specs to include KB tool #{kb_tool}"
    end
  end
end
