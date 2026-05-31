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

  defp load_workflow_with_front_matter(front_matter) do
    content = "---\n" <> front_matter <> "---\n"
    File.write!(Workflow.workflow_file_path(), content)

    if Process.whereis(SymphonyElixir.WorkflowStore) do
      SymphonyElixir.WorkflowStore.force_reload()
    end

    :ok
  end
end
