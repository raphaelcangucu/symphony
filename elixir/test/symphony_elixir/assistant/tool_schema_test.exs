defmodule SymphonyElixir.Assistant.ToolSchemaTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.{ProjectBoardTools, ToolExecutor, ToolSchema}

  @tools_without_required ~w(get_project list_project_repositories get_agent_executions get_workflow list_issues)

  describe "with_project_slug/1 regression (badkey on missing required)" do
    test "old map-update pattern raises badkey when schema omits required" do
      schema = %{"type" => "object", "additionalProperties" => false, "properties" => %{}}

      assert_raise KeyError, ~r/key "required" not found/, fn ->
        _broken = %{schema | "required" => ["project_slug"]}
      end
    end

    test "does not raise for schemas copied from ToolExecutor without a required list" do
      for name <- @tools_without_required do
        source = ToolExecutor.tool_specs() |> Enum.find(&(&1["name"] == name))
        assert source, "missing source spec #{name}"
        refute Map.has_key?(source["inputSchema"], "required"), "#{name} must lack required pre-wrap"

        assert spec = ToolSchema.with_project_slug(source)
        assert spec["inputSchema"]["required"] == ["project_slug"]
        assert Map.has_key?(spec["inputSchema"]["properties"], "project_slug")
      end
    end

    test "handles atom-key inputSchema (defensive)" do
      spec = %{
        "name" => "get_project",
        "description" => "test",
        inputSchema: %{
          type: "object",
          properties: %{}
        }
      }

      result = ToolSchema.with_project_slug(spec)
      assert result["inputSchema"]["required"] == ["project_slug"]
    end

    test "prepends project_slug to existing required fields" do
      spec = %{
        "name" => "move_issue",
        "description" => "test",
        "inputSchema" => %{
          "type" => "object",
          "required" => ["identifier", "status"],
          "properties" => %{"identifier" => %{}, "status" => %{}}
        }
      }

      result = ToolSchema.with_project_slug(spec)
      assert result["inputSchema"]["required"] == ["project_slug", "identifier", "status"]
    end
  end

  describe "freeform tool registration (CodexSession.run_freeform_turn path)" do
    test "ProjectBoardTools.tool_specs/0 builds every scoped tool without raising" do
      assert length(ProjectBoardTools.tool_specs()) == length(ProjectBoardTools.tools())
    end

    test "ToolExecutor.freeform_tool_specs/0 matches production freeform turn setup" do
      specs = ToolExecutor.freeform_tool_specs()

      assert Enum.all?(specs, fn spec ->
               is_binary(spec["name"]) and is_map(spec["inputSchema"]) and
                 is_map(spec["inputSchema"]["properties"] || %{})
             end)

      for name <- @tools_without_required do
        spec = Enum.find(specs, &(&1["name"] == name))
        assert spec, "freeform must expose #{name}"
        assert "project_slug" in spec["inputSchema"]["required"]
      end
    end
  end
end
