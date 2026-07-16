defmodule SymphonyElixir.DevServer.SnapshotTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.Snapshot

  describe "local_url/2" do
    test "returns nil for a missing or non-positive port" do
      assert Snapshot.local_url(nil, %{slug: "web"}) == nil
      assert Snapshot.local_url(0, %{slug: "web"}) == nil
      assert Snapshot.local_url(-1, %{slug: "web"}) == nil
      assert Snapshot.local_url("4300", %{slug: "web"}) == nil
    end

    test "prefers the serve step ready_path over url_path" do
      assert Snapshot.local_url(4300, %{slug: "web", ready_path: "/health", url_path: "/"}) ==
               "http://127.0.0.1:4300/health"
    end

    test "falls back to url_path when ready_path is blank" do
      assert Snapshot.local_url(4300, %{slug: "web", ready_path: "", url_path: "/app"}) ==
               "http://127.0.0.1:4300/app"
    end

    test "normalizes a path that is missing its leading slash" do
      assert Snapshot.local_url(4300, %{slug: "web", ready_path: "health"}) ==
               "http://127.0.0.1:4300/health"
    end

    test "routes admin-flavored slugs to the site root when no paths are configured" do
      assert Snapshot.local_url(4201, %{slug: "distributionmachine-admin"}) ==
               "http://127.0.0.1:4201/"
    end

    test "defaults non-admin slugs to the api health path" do
      assert Snapshot.local_url(4200, %{slug: "api"}) == "http://127.0.0.1:4200/api/health"
    end

    test "reads string-keyed step maps" do
      assert Snapshot.local_url(4300, %{"slug" => "web", "ready_path" => "/ok"}) ==
               "http://127.0.0.1:4300/ok"
    end

    test "tolerates a nil step" do
      assert Snapshot.local_url(4300, nil) == "http://127.0.0.1:4300/api/health"
    end
  end

  describe "sync_state/3" do
    test "ready on an allowed port is in_sync" do
      assert Snapshot.sync_state("ready", 4300, [4300, 4301]) == {:in_sync, nil}
    end

    test "ready on an out-of-lease port is a conflict with an explicit reason" do
      assert {:conflict, reason} = Snapshot.sync_state("ready", 59_595, [4300, 4301])
      assert reason =~ "59595"
      assert reason =~ "outside allowed ports"
    end

    test "crashed is not_ready" do
      assert Snapshot.sync_state("crashed", 4300, [4300]) == {:not_ready, nil}
    end

    test "pre-ready lifecycle statuses are awaiting_report" do
      for status <- ~w(stopped pending provisioning starting) do
        assert Snapshot.sync_state(status, nil, [4300]) == {:awaiting_report, nil}
      end
    end
  end
end
