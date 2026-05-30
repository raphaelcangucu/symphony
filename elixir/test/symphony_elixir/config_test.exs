defmodule SymphonyElixir.ConfigTest do
  use SymphonyElixir.TestSupport

  describe "observability hub config" do
    test "defaults when observability section omits hub keys" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      """)

      assert SymphonyElixir.Config.observability_hub_url() == nil
      assert SymphonyElixir.Config.observability_heartbeat_interval_ms() == 5_000
      assert SymphonyElixir.Config.observability_min_report_interval_ms() == 250
    end

    test "reads configured hub keys" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      observability:
        hub_url: http://localhost:4000
        heartbeat_interval_ms: 2000
        min_report_interval_ms: 100
        label: acme-app
        runtime_id: acme-runtime-1
      """)

      assert SymphonyElixir.Config.observability_hub_url() == "http://localhost:4000"
      assert SymphonyElixir.Config.observability_heartbeat_interval_ms() == 2_000
      assert SymphonyElixir.Config.observability_min_report_interval_ms() == 100
      assert SymphonyElixir.Config.observability_label() == "acme-app"
      assert SymphonyElixir.Config.observability_runtime_id() == "acme-runtime-1"
    end

    test "runtime_id falls back to the workflow file path" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      """)

      assert SymphonyElixir.Config.observability_runtime_id() ==
               SymphonyElixir.Workflow.workflow_file_path()
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
