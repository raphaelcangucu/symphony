defmodule SymphonyElixir.Codex.ConfigTest do
  use SymphonyElixir.TestSupport

  describe "goals_enabled?/0" do
    test "defaults to false" do
      assert SymphonyElixir.Codex.Config.goals_enabled?() == false
    end

    test "returns true when codex goals_enabled is true" do
      load_workflow_with_front_matter("""
      codex:
        goals_enabled: true
      """)

      assert SymphonyElixir.Codex.Config.goals_enabled?() == true
    end
  end

  describe "approval_policy/0,1" do
    test "defaults to a valid Codex app-server variant when unset" do
      assert SymphonyElixir.Codex.Config.approval_policy() == "untrusted"
    end

    test "honors an explicit per-project codex section" do
      section = %{"approval_policy" => "on-request"}
      assert SymphonyElixir.Codex.Config.approval_policy(section) == "on-request"
    end
  end

  describe "command/0,1" do
    test "honors an explicit per-project codex section" do
      section = %{"command" => "codex --config shell_environment_policy.inherit=all app-server"}

      assert SymphonyElixir.Codex.Config.command(section) ==
               "codex --config shell_environment_policy.inherit=all app-server"
    end
  end

  describe "runtime_settings/0,1,2" do
    test "resolves approval policy from an explicit per-project section" do
      section = %{"approval_policy" => "never", "thread_sandbox" => "workspace-write"}

      assert {:ok, %{approval_policy: "never", thread_sandbox: "workspace-write"}} =
               SymphonyElixir.Codex.Config.runtime_settings(section, nil)
    end
  end

  defp load_workflow_with_front_matter(front_matter) do
    content = "---\n" <> front_matter <> "---\n"
    File.write!(Workflow.workflow_file_path(), content)
    :ok
  end
end
