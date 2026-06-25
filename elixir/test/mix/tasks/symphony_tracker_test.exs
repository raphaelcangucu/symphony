defmodule Mix.Tasks.Symphony.TrackerTest do
  use ExUnit.Case, async: true

  alias Mix.Tasks.Symphony.Tracker

  test "issues maps to list_issues with slug and search switch" do
    assert {:ok, "list_issues", "macro", args, _opts} =
             Tracker.build(["issues", "macro", "--search", "login"])

    assert args["search"] == "login"
  end

  test "issue maps to get_issue with identifier" do
    assert {:ok, "get_issue", "macro", %{"identifier" => "MAC-1"}, _opts} =
             Tracker.build(["issue", "macro", "MAC-1"])
  end

  test "move maps positionals to identifier and status" do
    assert {:ok, "move_issue", "macro", args, _opts} =
             Tracker.build(["move", "macro", "MAC-1", "In Progress"])

    assert args["identifier"] == "MAC-1"
    assert args["status"] == "In Progress"
  end

  test "pr-link maps to link_pull_request" do
    assert {:ok, "link_pull_request", "macro", args, _opts} =
             Tracker.build(["pr-link", "macro", "MAC-1", "https://github.com/o/r/pull/9"])

    assert args["url"] == "https://github.com/o/r/pull/9"
  end

  test "blockers-add maps to manage_blockers create" do
    assert {:ok, "manage_blockers", "macro", args, _opts} =
             Tracker.build(["blockers-add", "macro", "MAC-1", "MAC-2"])

    assert args["action"] == "create"
    assert args["target"] == "MAC-2"
  end

  test "blockers defaults to the list action" do
    assert {:ok, "manage_blockers", "macro", args, _opts} =
             Tracker.build(["blockers", "macro", "MAC-1"])

    assert args["action"] == "list"
  end

  test "dev-env maps category switch to category_filter" do
    assert {:ok, "manage_dev_env", "macro", args, _opts} =
             Tracker.build(["dev-env", "macro", "list_steps", "--category", "serve"])

    assert args["action"] == "list_steps"
    assert args["category_filter"] == "serve"
  end

  test "preview defaults action to status" do
    assert {:ok, "manage_preview", "macro", %{"identifier" => "MAC-1", "action" => "status"}, _opts} =
             Tracker.build(["preview", "macro", "MAC-1"])
  end

  test "projects needs no slug" do
    assert {:ok, "list_tracker_projects", nil, args, _opts} = Tracker.build(["projects"])
    assert args == %{}
  end

  test "running works without a slug (all projects)" do
    assert {:ok, "list_running_agents", nil, args, _opts} = Tracker.build(["running"])
    assert args == %{}
  end

  test "running accepts an optional slug to scope to a project" do
    assert {:ok, "list_running_agents", "macro", args, _opts} = Tracker.build(["running", "macro"])
    assert args == %{}
  end

  test "steer maps positionals to identifier and message" do
    assert {:ok, "steer_agent", "macro", args, _opts} =
             Tracker.build(["steer", "macro", "MAC-1", "focus on the failing test"])

    assert args["identifier"] == "MAC-1"
    assert args["message"] == "focus on the failing test"
  end

  test "steer without a message is an error" do
    assert {:error, {:missing_args, "steer"}} = Tracker.build(["steer", "macro", "MAC-1"])
  end

  test "--json sets json option" do
    assert {:ok, _tool, _slug, _args, opts} = Tracker.build(["issue", "macro", "MAC-1", "--json"])
    assert opts[:json] == true
  end

  test "unknown command is an error" do
    assert {:error, {:unknown_command, "wat"}} = Tracker.build(["wat"])
  end

  test "missing positionals is an error" do
    assert {:error, {:missing_args, "move"}} = Tracker.build(["move", "macro"])
  end

  test "missing slug is an error" do
    assert {:error, {:missing_args, "issue"}} = Tracker.build(["issue"])
  end
end
