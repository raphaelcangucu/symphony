defmodule Mix.Tasks.Symphony.ToolTest do
  use ExUnit.Case, async: true

  alias Mix.Tasks.Symphony.Tool

  test "list returns catalog including manage_preview and discovery tools" do
    assert {:ok, :list, tools, opts} = Tool.build(["list"])
    names = Enum.map(tools, & &1["name"])

    assert "manage_preview" in names
    assert "list_issues" in names
    assert "list_tracker_projects" in names
    assert "github_graphql" in names
    assert opts[:json] == false
  end

  test "list --json sets json option" do
    assert {:ok, :list, _tools, opts} = Tool.build(["list", "--json"])
    assert opts[:json] == true
  end

  test "schema returns inputSchema for manage_preview" do
    assert {:ok, :schema, spec, _opts} = Tool.build(["schema", "manage_preview"])
    assert spec["name"] == "manage_preview"
    assert get_in(spec, ["inputSchema", "properties", "action"])
  end

  test "schema unknown tool is an error" do
    assert {:error, {:unknown_tool, "not_a_real_tool"}} = Tool.build(["schema", "not_a_real_tool"])
  end

  test "call maps project and arg flags for manage_preview" do
    assert {:ok, :call, "manage_preview", "advising", args, opts} =
             Tool.build([
               "call",
               "manage_preview",
               "--project",
               "advising",
               "--identifier",
               "CDE-1180",
               "--arg",
               "action=status",
               "--json"
             ])

    assert args["identifier"] == "CDE-1180"
    assert args["action"] == "status"
    assert opts[:json] == true
  end

  test "call accepts -p and boolean JSON arg values" do
    assert {:ok, :call, "list_issues", "macro", args, _opts} =
             Tool.build(["call", "list_issues", "-p", "macro", "--arg", "include_comments=true"])

    assert args["include_comments"] == true
  end

  test "call maps category alias to category_filter" do
    assert {:ok, :call, "manage_dev_env", "macro", args, _opts} =
             Tool.build([
               "call",
               "manage_dev_env",
               "-p",
               "macro",
               "--action",
               "list_steps",
               "--category",
               "serve"
             ])

    assert args["action"] == "list_steps"
    assert args["category_filter"] == "serve"
  end

  test "call requires project for project-scoped tools" do
    assert {:error, :project_slug_required} =
             Tool.build(["call", "manage_preview", "--action", "status", "--identifier", "X"])
  end

  test "call allows discovery tools without project" do
    assert {:ok, :call, "list_tracker_projects", nil, args, _opts} =
             Tool.build(["call", "list_tracker_projects"])

    assert args == %{}
  end

  test "call rejects missing required schema keys" do
    assert {:error, {:missing_required, missing}} =
             Tool.build(["call", "manage_preview", "-p", "advising", "--action", "status"])

    assert "identifier" in missing
  end

  test "unknown subcommand is an error" do
    assert {:error, {:unknown_subcommand, "wat"}} = Tool.build(["wat"])
  end

  test "empty argv is an error" do
    assert {:error, :no_command} = Tool.build([])
  end
end
