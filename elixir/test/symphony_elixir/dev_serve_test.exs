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

  describe "discovery_dir/1" do
    test "is enabled by default and defaults to the current working directory" do
      assert {:ok, dir} = DevServe.discovery_dir(%{})
      assert dir == File.cwd!()
    end

    test "honors an explicit scan directory" do
      assert {:ok, dir} = DevServe.discovery_dir(%{"SYMPHONY_WORKFLOW_DIR" => "some/dir"})
      assert dir == Path.expand("some/dir")
    end

    test "is disabled by falsy flag values" do
      for value <- ["0", "false", "no", "OFF", " False "] do
        assert :disabled = DevServe.discovery_dir(%{"SYMPHONY_WORKFLOW_DISCOVERY" => value}),
               "expected #{inspect(value)} to disable discovery"
      end
    end

    test "stays enabled for truthy / unrecognized flag values" do
      assert {:ok, _} = DevServe.discovery_dir(%{"SYMPHONY_WORKFLOW_DISCOVERY" => "1"})
      assert {:ok, _} = DevServe.discovery_dir(%{"SYMPHONY_WORKFLOW_DISCOVERY" => "true"})
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
