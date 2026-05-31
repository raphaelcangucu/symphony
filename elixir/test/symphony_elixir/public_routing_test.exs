defmodule SymphonyElixir.PublicRoutingTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.PublicRouting

  describe "sanitize_label/1" do
    test "lowercases and replaces invalid chars with hyphen" do
      assert PublicRouting.sanitize_label("MM 42/Front") == "mm-42-front"
    end

    test "collapses repeats and strips leading/trailing hyphens" do
      assert PublicRouting.sanitize_label("--a__b--") == "a-b"
    end
  end

  describe "host_for/4" do
    test "builds <project>-<issue>-<step>.<ns>.<base>" do
      assert PublicRouting.host_for("previsions", "mm-42", "front", namespace: "octocat", base_domain: "tracker.cods.dev") ==
               {:ok, "previsions-mm-42-front.octocat.tracker.cods.dev"}
    end

    test "shortens label over 63 chars with a hash suffix" do
      long = String.duplicate("x", 80)
      {:ok, host} = PublicRouting.host_for(long, "mm-42", "front", namespace: "octocat", base_domain: "tracker.cods.dev")
      [label | _] = String.split(host, ".")
      assert String.length(label) <= 63
      assert String.ends_with?(host, ".octocat.tracker.cods.dev")
    end
  end

  describe "tracker_host/1 and namespace_suffix/1" do
    test "tracker host is <ns>.<base>" do
      assert PublicRouting.tracker_host(namespace: "octocat", base_domain: "tracker.cods.dev") ==
               "octocat.tracker.cods.dev"
    end

    test "namespace suffix has a leading dot" do
      assert PublicRouting.namespace_suffix(namespace: "octocat", base_domain: "tracker.cods.dev") ==
               ".octocat.tracker.cods.dev"
    end
  end

  describe "resolve_namespace/1" do
    test "uses the configured namespace override when present" do
      load_public_tunnel_workflow!(namespace: "Team-Cods")
      assert PublicRouting.resolve_namespace() == {:ok, "team-cods"}
    end

    test "falls back to the injected viewer login when no override" do
      load_public_tunnel_workflow!(namespace: nil)
      viewer = fn -> {:ok, %{login: "Octo-Cat"}} end
      assert PublicRouting.resolve_namespace(viewer: viewer) == {:ok, "octo-cat"}
    end

    test "returns :no_namespace when override absent and viewer fails" do
      load_public_tunnel_workflow!(namespace: nil)
      viewer = fn -> {:error, :missing_github_token} end
      assert PublicRouting.resolve_namespace(viewer: viewer) == {:error, :no_namespace}
    end
  end

  describe "host_for/4 namespace fallback" do
    test "resolves the namespace via opts viewer when not passed explicitly" do
      load_public_tunnel_workflow!(namespace: nil)
      viewer = fn -> {:ok, %{login: "octocat"}} end

      assert PublicRouting.host_for("previsions", "#mm-42", "front",
               base_domain: "tracker.cods.dev",
               viewer: viewer
             ) == {:ok, "previsions-mm-42-front.octocat.tracker.cods.dev"}
    end

    test "propagates :no_namespace error" do
      load_public_tunnel_workflow!(namespace: nil)
      viewer = fn -> {:error, :x} end

      assert PublicRouting.host_for("p", "i", "s", base_domain: "tracker.cods.dev", viewer: viewer) ==
               {:error, :no_namespace}
    end
  end

  describe "preview_host/4" do
    test "nil when tunnel disabled" do
      load_public_tunnel_workflow!(enabled: false)
      assert PublicRouting.preview_host("previsions", "mm-42", "front") == nil
    end

    test "host when enabled and namespace resolves" do
      load_public_tunnel_workflow!(namespace: "octocat")

      assert PublicRouting.preview_host("previsions", "mm-42", "front", base_domain: "tracker.cods.dev") ==
               "previsions-mm-42-front.octocat.tracker.cods.dev"
    end

    test "nil when enabled but namespace cannot resolve" do
      load_public_tunnel_workflow!(namespace: nil)

      assert PublicRouting.preview_host("p", "i", "s",
               base_domain: "tracker.cods.dev",
               viewer: fn -> {:error, :x} end
             ) == nil
    end
  end

  describe "register/unregister/lookup" do
    setup do
      case Process.whereis(SymphonyElixir.PublicRouting) do
        nil -> start_supervised!(SymphonyElixir.PublicRouting)
        _pid -> :ok
      end

      :ok
    end

    test "register then lookup returns the port" do
      assert :ok = PublicRouting.register("mm-42-front.octocat.tracker.cods.dev", 4123)
      assert {:ok, 4123} = PublicRouting.lookup("mm-42-front.octocat.tracker.cods.dev")
    end

    test "unregister removes the mapping" do
      PublicRouting.register("a.octocat.tracker.cods.dev", 4101)
      assert :ok = PublicRouting.unregister("a.octocat.tracker.cods.dev")
      assert :error = PublicRouting.lookup("a.octocat.tracker.cods.dev")
    end

    test "lookup of unknown host returns :error" do
      assert :error = PublicRouting.lookup("nope.octocat.tracker.cods.dev")
    end
  end

  defp load_public_tunnel_workflow!(opts) do
    namespace = Keyword.get(opts, :namespace)
    enabled = Keyword.get(opts, :enabled, true)

    namespace_line =
      if is_binary(namespace) and namespace != "" do
        "  namespace: #{namespace}\n"
      else
        ""
      end

    front_matter =
      "github:\n  repo: acme/app\npublic_tunnel:\n  enabled: #{enabled}\n" <> namespace_line

    content = "---\n" <> front_matter <> "---\n"
    File.write!(Workflow.workflow_file_path(), content)

    if Process.whereis(SymphonyElixir.WorkflowStore) do
      SymphonyElixir.WorkflowStore.force_reload()
    end

    :ok
  end
end
