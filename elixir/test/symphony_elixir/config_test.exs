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

    test "per-project dev_server port_range defaults to nil (auto pool)" do
      opts = SymphonyElixir.Config.validate_front_matter(%{"dev_server" => %{"enabled" => true}})
      assert get_in(opts, [:dev_server, :port_range]) == nil
    end

    test "per-project dev_server port_range keeps an explicit pin" do
      opts =
        SymphonyElixir.Config.validate_front_matter(%{
          "dev_server" => %{"enabled" => true, "port_range" => [4100, 4199]}
        })

      assert get_in(opts, [:dev_server, :port_range]) == [4100, 4199]
    end

    test "per-project dev_server reclaim_ports defaults to false" do
      opts = SymphonyElixir.Config.validate_front_matter(%{"dev_server" => %{"enabled" => true}})
      assert get_in(opts, [:dev_server, :reclaim_ports]) == false
    end

    test "per-project dev_server reclaim_ports honors an explicit true" do
      opts =
        SymphonyElixir.Config.validate_front_matter(%{
          "dev_server" => %{"enabled" => true, "reclaim_ports" => true}
        })

      assert get_in(opts, [:dev_server, :reclaim_ports]) == true
    end
  end

  describe "evidence workflow section" do
    test "validate_front_matter parses the per-repo evidence block" do
      validated =
        SymphonyElixir.Config.validate_front_matter(%{
          "evidence" => %{
            "required" => true,
            "repos" => %{
              "frontend" => %{
                "unit_command" => "yarn test --run",
                "ui_paths" => ["src/**", "components/**"],
                "e2e" => %{"command" => "npx playwright test"}
              },
              "backend" => %{
                "unit_command" => "./vibe test",
                "impacts" => ["frontend"],
                "contract_paths" => ["app/Http/**", "routes/**"]
              }
            }
          }
        })

      assert get_in(validated, [:evidence, :required]) == true

      assert get_in(validated, [:evidence, :repos, "frontend"]) == %{
               unit_command: "yarn test --run",
               ui_paths: ["src/**", "components/**"],
               e2e: %{command: "npx playwright test"}
             }

      assert get_in(validated, [:evidence, :repos, "backend"]) == %{
               unit_command: "./vibe test",
               impacts: ["frontend"],
               contract_paths: ["app/Http/**", "routes/**"]
             }
    end

    test "validate_front_matter converts the legacy flat evidence format" do
      validated =
        SymphonyElixir.Config.validate_front_matter(%{
          "evidence" => %{
            "test_command" => %{"frontend" => "npm test", "backend" => "./vibe test"},
            "e2e_command" => %{"frontend" => "npx playwright test"},
            "ui_paths" => ["frontend/src/**"],
            "required" => true
          }
        })

      assert get_in(validated, [:evidence, :required]) == true

      assert get_in(validated, [:evidence, :repos, "frontend"]) == %{
               unit_command: "npm test",
               ui_paths: ["src/**"],
               e2e: %{command: "npx playwright test"}
             }

      assert get_in(validated, [:evidence, :repos, "backend"]) == %{unit_command: "./vibe test"}
    end

    test "omitted evidence block defaults to disabled with no repos" do
      validated = SymphonyElixir.Config.validate_front_matter(%{})
      assert get_in(validated, [:evidence, :required]) == false
      assert get_in(validated, [:evidence, :repos]) == %{}
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

    test "returns nil (inherit) when both agent sections are present without explicit kind" do
      assert SymphonyElixir.Config.agent_kind_from_config(%{"codex" => %{}, "claude" => %{}}) ==
               nil
    end

    test "returns nil (inherit) when no agent section is present" do
      assert SymphonyElixir.Config.agent_kind_from_config(%{}) == nil
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
    @observability_hub_env [
      :observability_hub_url,
      :observability_heartbeat_interval_ms,
      :observability_min_report_interval_ms,
      :observability_label,
      :observability_runtime_id
    ]

    test "defaults when no observability hub env is set" do
      clear_instance_env(@observability_hub_env)

      assert SymphonyElixir.Config.observability_hub_url() == nil
      assert SymphonyElixir.Config.observability_heartbeat_interval_ms() == 5_000
      assert SymphonyElixir.Config.observability_min_report_interval_ms() == 250
    end

    test "reads configured hub keys from env" do
      put_instance_env(
        observability_hub_url: "http://localhost:4000",
        observability_heartbeat_interval_ms: 2_000,
        observability_min_report_interval_ms: 100,
        observability_label: "acme-app",
        observability_runtime_id: "acme-runtime-1"
      )

      assert SymphonyElixir.Config.observability_hub_url() == "http://localhost:4000"
      assert SymphonyElixir.Config.observability_heartbeat_interval_ms() == 2_000
      assert SymphonyElixir.Config.observability_min_report_interval_ms() == 100
      assert SymphonyElixir.Config.observability_label() == "acme-app"
      assert SymphonyElixir.Config.observability_runtime_id() == "acme-runtime-1"
    end

    test "runtime_id falls back to a stable default when unset" do
      clear_instance_env(@observability_hub_env)

      assert SymphonyElixir.Config.observability_runtime_id() == "symphony"
    end
  end

  describe "editor config" do
    @editor_env [
      :editor_enabled,
      :editor_binary,
      :editor_host,
      :editor_port,
      :editor_auth,
      :editor_password,
      :editor_base_url
    ]

    test "defaults when no editor env is set" do
      clear_instance_env(@editor_env)

      refute SymphonyElixir.Config.editor_enabled?()
      assert SymphonyElixir.Config.editor_binary() == "code-server"
      assert SymphonyElixir.Config.editor_host() == "127.0.0.1"
      assert SymphonyElixir.Config.editor_port() == 4002
      assert SymphonyElixir.Config.editor_auth() == "none"
      assert SymphonyElixir.Config.editor_password() == nil
      assert SymphonyElixir.Config.editor_base_url() == "http://127.0.0.1:4002"
    end

    test "reads configured editor keys from env" do
      put_instance_env(
        editor_enabled: true,
        editor_binary: "/opt/code-server/bin/code-server",
        editor_host: "0.0.0.0",
        editor_port: 5000,
        editor_auth: "password",
        editor_password: "hunter2",
        editor_base_url: "https://editor.example.com"
      )

      assert SymphonyElixir.Config.editor_enabled?()
      assert SymphonyElixir.Config.editor_binary() == "/opt/code-server/bin/code-server"
      assert SymphonyElixir.Config.editor_host() == "0.0.0.0"
      assert SymphonyElixir.Config.editor_port() == 5000
      assert SymphonyElixir.Config.editor_auth() == "password"
      assert SymphonyElixir.Config.editor_password() == "hunter2"
      assert SymphonyElixir.Config.editor_base_url() == "https://editor.example.com"
    end

    test "editor_base_url trims a trailing slash from a configured base_url" do
      clear_instance_env(@editor_env)
      put_instance_env(editor_base_url: "https://editor.example.com/")

      assert SymphonyElixir.Config.editor_base_url() == "https://editor.example.com"
    end

    test "editor_base_url falls back to host and port when base_url is empty" do
      clear_instance_env(@editor_env)
      put_instance_env(editor_host: "127.0.0.1", editor_port: 4002, editor_base_url: "")

      assert SymphonyElixir.Config.editor_base_url() == "http://127.0.0.1:4002"
    end

    test "editor_base_url maps wildcard IPv4 bind host to loopback in fallback" do
      clear_instance_env(@editor_env)
      put_instance_env(editor_host: "0.0.0.0", editor_port: 4002)

      assert SymphonyElixir.Config.editor_host() == "0.0.0.0"
      assert SymphonyElixir.Config.editor_base_url() == "http://127.0.0.1:4002"
    end

    test "editor_base_url maps wildcard IPv6 bind host to bracketed loopback in fallback" do
      clear_instance_env(@editor_env)
      put_instance_env(editor_host: "::", editor_port: 4002)

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

  describe "pr_monitor_interval_ms/0" do
    test "falls back to poll_interval_ms when unset" do
      clear_instance_env([:pr_monitor_interval_ms, :poll_interval_ms])

      assert SymphonyElixir.Config.pr_monitor_interval_ms() ==
               SymphonyElixir.Config.poll_interval_ms()

      put_instance_env(poll_interval_ms: 30_000)

      assert SymphonyElixir.Config.pr_monitor_interval_ms() == 30_000
    end

    test "uses explicit value when set" do
      clear_instance_env([:pr_monitor_interval_ms, :poll_interval_ms])
      put_instance_env(pr_monitor_interval_ms: 15_000)

      assert SymphonyElixir.Config.pr_monitor_interval_ms() == 15_000
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
    :ok
  end

  defp put_instance_env(pairs) do
    Enum.each(pairs, fn {key, value} ->
      Application.put_env(:symphony_elixir, key, value)
      on_exit(fn -> Application.delete_env(:symphony_elixir, key) end)
    end)

    :ok
  end

  defp clear_instance_env(keys) do
    Enum.each(keys, fn key ->
      previous = Application.get_env(:symphony_elixir, key)
      Application.delete_env(:symphony_elixir, key)
      on_exit(fn -> restore_env_value(key, previous) end)
    end)

    :ok
  end

  defp restore_env_value(_key, nil), do: :ok
  defp restore_env_value(key, value), do: Application.put_env(:symphony_elixir, key, value)
end
