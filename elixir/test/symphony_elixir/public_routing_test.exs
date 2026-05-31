defmodule SymphonyElixir.PublicRoutingTest do
  use ExUnit.Case, async: false

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
end
