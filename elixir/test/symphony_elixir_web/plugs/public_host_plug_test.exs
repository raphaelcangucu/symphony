defmodule SymphonyElixirWeb.PublicHostPlugTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.PublicRouting
  alias SymphonyElixir.Workflow
  alias SymphonyElixirWeb.PublicHostPlug

  setup do
    workflow_root =
      Path.join(
        System.tmp_dir!(),
        "symphony-public-host-plug-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(workflow_root)
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    File.write!(workflow_file, "---\ngithub:\n  repo: acme/app\n---\n")
    Workflow.set_workflow_file_path(workflow_file)
    reload_workflow_store!()

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf(workflow_root)
    end)

    :ok
  end

  defp call(host) do
    :get
    |> build_conn("/")
    |> Map.put(:host, host)
    |> PublicHostPlug.call(PublicHostPlug.init([]))
  end

  describe "with tunnel disabled (default WORKFLOW)" do
    test "loopback passes through (not halted)" do
      refute call("127.0.0.1").halted
    end

    test "any other host passes through when disabled" do
      refute call("anything.octocat.tracker.cods.dev").halted
    end
  end

  describe "with tunnel enabled" do
    setup do
      enable_public_tunnel!(namespace: "octocat", base_domain: "tracker.cods.dev")
      ensure_public_routing_started!()
      :ok
    end

    test "tracker host passes through" do
      refute call("octocat.tracker.cods.dev").halted
    end

    test "loopback passes through" do
      refute call("localhost").halted
    end

    test "host outside namespace suffix passes through" do
      refute call("evil.example.com").halted
    end

    test "sibling-namespace spoof host passes through (leading-dot suffix guard)" do
      # ends with "octocat.tracker.cods.dev" but not ".octocat.tracker.cods.dev"
      refute call("eviloctocat.tracker.cods.dev").halted
    end

    test "unknown in-suffix host returns 404" do
      conn = call("ghost.octocat.tracker.cods.dev")
      assert conn.halted
      assert conn.status == 404
    end

    test "registered preview host with out-of-range port returns 404" do
      PublicRouting.register("bad.octocat.tracker.cods.dev", 9999)
      conn = call("bad.octocat.tracker.cods.dev")
      assert conn.halted
      assert conn.status == 404
    end
  end

  defp enable_public_tunnel!(opts) do
    namespace = Keyword.fetch!(opts, :namespace)
    base_domain = Keyword.fetch!(opts, :base_domain)

    front_matter =
      "github:\n  repo: acme/app\n" <>
        "public_tunnel:\n  enabled: true\n  namespace: #{namespace}\n  base_domain: #{base_domain}\n"

    File.write!(Workflow.workflow_file_path(), "---\n" <> front_matter <> "---\n")
    reload_workflow_store!()
    :ok
  end

  defp ensure_public_routing_started! do
    case Process.whereis(SymphonyElixir.PublicRouting) do
      nil -> start_supervised!(SymphonyElixir.PublicRouting)
      _ -> :ok
    end
  end

  defp reload_workflow_store! do
    :ok
  end
end
