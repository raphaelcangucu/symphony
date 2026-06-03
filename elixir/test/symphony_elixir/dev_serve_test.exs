defmodule SymphonyElixir.DevServeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServe

  describe "resolve_workflow_source/3" do
    test "an explicit CLI path that exists resolves to that workflow" do
      exists? = fn path -> path == Path.expand("custom/WORKFLOW.md") end

      assert {:ok, path} =
               DevServe.resolve_workflow_source(["custom/WORKFLOW.md"], %{}, exists?)

      assert path == Path.expand("custom/WORKFLOW.md")
    end

    test "an explicit CLI path that is missing reports the missing path (still a hard error)" do
      exists? = fn _ -> false end

      assert {:missing, path} =
               DevServe.resolve_workflow_source(["custom/WORKFLOW.md"], %{}, exists?)

      assert path == Path.expand("custom/WORKFLOW.md")
    end

    test "SYMPHONY_WORKFLOW env var is honored when it exists" do
      env = %{"SYMPHONY_WORKFLOW" => "env/WORKFLOW.md"}
      exists? = fn path -> path == Path.expand("env/WORKFLOW.md") end

      assert {:ok, path} = DevServe.resolve_workflow_source([], env, exists?)
      assert path == Path.expand("env/WORKFLOW.md")
    end

    test "no workflow configured and no default file present boots without a workflow" do
      exists? = fn _ -> false end

      assert :none = DevServe.resolve_workflow_source([], %{}, exists?)
    end

    test "no workflow configured but a default WORKFLOW.md present uses it for backward compatibility" do
      default = Path.expand("WORKFLOW.md")
      exists? = fn path -> path == default end

      assert {:ok, ^default} = DevServe.resolve_workflow_source([], %{}, exists?)
    end

    test "blank CLI arg and blank env are treated as unconfigured" do
      exists? = fn _ -> false end

      assert :none = DevServe.resolve_workflow_source([""], %{"SYMPHONY_WORKFLOW" => ""}, exists?)
    end
  end

  describe "resolve_port/1" do
    test "returns {:ok, nil} when no port override is configured" do
      assert DevServe.resolve_port(%{}) == {:ok, nil}
    end

    test "parses a valid port override" do
      assert DevServe.resolve_port(%{"SYMPHONY_TRACKER_PORT" => "4567"}) == {:ok, 4567}
    end

    test "rejects a non-integer port override" do
      assert {:error, message} = DevServe.resolve_port(%{"SYMPHONY_TRACKER_PORT" => "abc"})
      assert message =~ "Invalid SYMPHONY_TRACKER_PORT"
    end
  end
end
