defmodule SymphonyElixir.ConfigTest do
  use SymphonyElixir.TestSupport

  describe "assistant_draft_status/0" do
    test "defaults to Triage when unset" do
      assert SymphonyElixir.Config.assistant_draft_status() == "Triage"
    end
  end

  describe "parse_workflow_markdown/1" do
    test "validates behavior keys and returns front matter + body" do
      md = "---\ntracker:\n  active_states: [Todo]\nagent:\n  max_turns: 5\n---\n\nbody"

      assert {:ok, %{front_matter: fm, body: "body"}} =
               SymphonyElixir.Config.parse_workflow_markdown(md)

      assert get_in(fm, [:agent, :max_turns]) == 5
      assert get_in(fm, [:tracker, :active_states]) == ["Todo"]
    end

    test "rejects connection and process sections" do
      for section <- ~w(github linear local server observability polling editor) do
        md = "---\n#{section}: {}\n---\nb"
        assert {:error, msg} = SymphonyElixir.Config.parse_workflow_markdown(md)
        assert msg =~ section
      end
    end

    test "reports strict type errors" do
      md = "---\nagent:\n  max_turns: not-an-int\n---\nb"
      assert {:error, msg} = SymphonyElixir.Config.parse_workflow_markdown(md)
      assert msg =~ "max_turns"
    end
  end

  describe "validate_front_matter/1" do
    test "validates an arbitrary front-matter map and applies schema defaults" do
      opts =
        SymphonyElixir.Config.validate_front_matter(%{
          "tracker" => %{"active_states" => ["Todo", "In Progress"]}
        })

      assert get_in(opts, [:tracker, :active_states]) == ["Todo", "In Progress"]
      assert is_list(get_in(opts, [:tracker, :terminal_states]))
    end

    test "workflow_front_matter/0 returns the normalized global front matter map" do
      assert is_map(SymphonyElixir.Config.workflow_front_matter())
    end
  end

  describe "validate_workflow_config/1 (strict)" do
    test "accepts well-formed config (lists, integers, csv strings)" do
      assert :ok =
               SymphonyElixir.Config.validate_workflow_config(%{
                 "tracker" => %{"active_states" => ["Todo", "In Progress"]},
                 "polling" => %{"interval_ms" => 5000},
                 "workspace" => %{"root" => "~/code"}
               })

      assert :ok =
               SymphonyElixir.Config.validate_workflow_config(%{
                 "tracker" => %{"active_states" => "Todo,In Progress"}
               })
    end

    test "accepts an empty map and absent sections" do
      assert :ok = SymphonyElixir.Config.validate_workflow_config(%{})
    end

    test "rejects a state list given as a non-list/non-string scalar" do
      assert {:error, issues} =
               SymphonyElixir.Config.validate_workflow_config(%{
                 "tracker" => %{"active_states" => 123}
               })

      assert Enum.any?(issues, &(&1 =~ "tracker.active_states"))
    end

    test "rejects a section provided as a non-map" do
      assert {:error, issues} =
               SymphonyElixir.Config.validate_workflow_config(%{"tracker" => "nope"})

      assert Enum.any?(issues, &(&1 =~ "tracker must be a mapping"))
    end

    test "rejects an unparseable integer field" do
      assert {:error, issues} =
               SymphonyElixir.Config.validate_workflow_config(%{
                 "polling" => %{"interval_ms" => "abc"}
               })

      assert Enum.any?(issues, &(&1 =~ "polling.interval_ms"))
    end

    test "rejects non-map input entirely" do
      assert {:error, _} = SymphonyElixir.Config.validate_workflow_config("not-a-map")
    end
  end

  describe "agent_kind_from_config/1" do
    test "returns claude when only the claude section is present" do
      assert SymphonyElixir.Config.agent_kind_from_config(%{"claude" => %{}}) == "claude"
    end

    test "prefers codex when both agent sections are present" do
      assert SymphonyElixir.Config.agent_kind_from_config(%{"codex" => %{}, "claude" => %{}}) ==
               "codex"
    end

    test "falls back to the global default when no agent section is present" do
      assert SymphonyElixir.Config.agent_kind_from_config(%{}) ==
               SymphonyElixir.Config.default_agent_kind()
    end
  end

  describe "default_agent_kind/0" do
    test "uses the application-configured default when no global agent section is present" do
      write_workflow_file!(Workflow.workflow_file_path(), agent_kind: nil)
      previous = Application.get_env(:symphony_elixir, :default_agent_kind)
      Application.put_env(:symphony_elixir, :default_agent_kind, "claude")

      on_exit(fn ->
        if previous,
          do: Application.put_env(:symphony_elixir, :default_agent_kind, previous),
          else: Application.delete_env(:symphony_elixir, :default_agent_kind)
      end)

      assert SymphonyElixir.Config.configured_agent_kinds() == []
      assert SymphonyElixir.Config.default_agent_kind() == "claude"
    end

    test "falls back to the codex code default when nothing is configured" do
      write_workflow_file!(Workflow.workflow_file_path(), agent_kind: nil)
      previous = Application.get_env(:symphony_elixir, :default_agent_kind)
      Application.delete_env(:symphony_elixir, :default_agent_kind)

      on_exit(fn ->
        if previous, do: Application.put_env(:symphony_elixir, :default_agent_kind, previous)
      end)

      assert SymphonyElixir.Config.default_agent_kind() == "codex"
    end
  end

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

    test "editor_base_url maps wildcard IPv4 bind host to loopback in fallback" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      editor:
        host: 0.0.0.0
        port: 4002
      """)

      assert SymphonyElixir.Config.editor_host() == "0.0.0.0"
      assert SymphonyElixir.Config.editor_base_url() == "http://127.0.0.1:4002"
    end

    test "editor_base_url maps wildcard IPv6 bind host to bracketed loopback in fallback" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      editor:
        host: "::"
        port: 4002
      """)

      assert SymphonyElixir.Config.editor_host() == "::"
      assert SymphonyElixir.Config.editor_base_url() == "http://[::1]:4002"
    end
  end

  describe "dev_server config" do
    test "defaults when the dev_server section is omitted" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      """)

      refute SymphonyElixir.Config.dev_server_enabled?()
      assert SymphonyElixir.Config.dev_server_port_range() == [4100, 4199]
      assert SymphonyElixir.Config.dev_server_max_concurrent() == 3
      assert SymphonyElixir.Config.dev_server_idle_timeout_ms() == 1_800_000
      assert SymphonyElixir.Config.dev_server_auto_start_on() == ["pull_request", "human_review"]
      assert SymphonyElixir.Config.dev_server_base_url() == nil
    end

    test "reads configured dev_server keys" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      dev_server:
        enabled: true
        port_range: [5000, 5009]
        max_concurrent: 2
        idle_timeout_ms: 60000
        auto_start_on: [human_review]
        base_url: http://example.test
      """)

      assert SymphonyElixir.Config.dev_server_enabled?()
      assert SymphonyElixir.Config.dev_server_port_range() == [5000, 5009]
      assert SymphonyElixir.Config.dev_server_max_concurrent() == 2
      assert SymphonyElixir.Config.dev_server_idle_timeout_ms() == 60_000
      assert SymphonyElixir.Config.dev_server_auto_start_on() == ["human_review"]
      assert SymphonyElixir.Config.dev_server_base_url() == "http://example.test"
    end
  end

  describe "public_tunnel config" do
    test "defaults when public_tunnel section omitted" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      """)

      refute SymphonyElixir.Config.public_tunnel_enabled?()
      assert SymphonyElixir.Config.public_tunnel_base_domain() == "tracker.cods.dev"
      assert SymphonyElixir.Config.public_tunnel_namespace() == nil
    end

    test "reads configured public_tunnel keys" do
      load_workflow_with_front_matter("""
      github:
        repo: acme/app
      public_tunnel:
        enabled: true
        base_domain: tracker.example.dev
        namespace: octocat
      """)

      assert SymphonyElixir.Config.public_tunnel_enabled?()
      assert SymphonyElixir.Config.public_tunnel_base_domain() == "tracker.example.dev"
      assert SymphonyElixir.Config.public_tunnel_namespace() == "octocat"
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
