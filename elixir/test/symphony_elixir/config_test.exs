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

  describe "editor config" do
    test "defaults when the editor section is omitted" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      """)

      refute SymphonyElixir.Config.editor_enabled?()
      assert SymphonyElixir.Config.editor_binary() == "code-server"
      assert SymphonyElixir.Config.editor_host() == "127.0.0.1"
      assert SymphonyElixir.Config.editor_port() == 4002
      assert SymphonyElixir.Config.editor_auth() == "none"
      assert SymphonyElixir.Config.editor_password() == nil
      assert SymphonyElixir.Config.editor_base_url() == "http://127.0.0.1:4002"
    end

    test "reads configured editor keys" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      editor:
        enabled: true
        binary: /opt/code-server/bin/code-server
        host: 0.0.0.0
        port: 5000
        auth: password
        password: hunter2
        base_url: https://editor.example.com
      """)

      assert SymphonyElixir.Config.editor_enabled?()
      assert SymphonyElixir.Config.editor_binary() == "/opt/code-server/bin/code-server"
      assert SymphonyElixir.Config.editor_host() == "0.0.0.0"
      assert SymphonyElixir.Config.editor_port() == 5000
      assert SymphonyElixir.Config.editor_auth() == "password"
      assert SymphonyElixir.Config.editor_password() == "hunter2"
      assert SymphonyElixir.Config.editor_base_url() == "https://editor.example.com"
    end

    test "editor_base_url trims a trailing slash from a configured base_url" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      editor:
        base_url: https://editor.example.com/
      """)

      assert SymphonyElixir.Config.editor_base_url() == "https://editor.example.com"
    end

    test "editor_base_url falls back to host and port when base_url is empty" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      editor:
        host: 127.0.0.1
        port: 4002
        base_url: ""
      """)

      assert SymphonyElixir.Config.editor_base_url() == "http://127.0.0.1:4002"
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
