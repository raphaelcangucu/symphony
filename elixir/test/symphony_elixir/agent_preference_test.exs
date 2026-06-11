defmodule SymphonyElixir.AgentPreferenceTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentPreference
  alias SymphonyElixir.AgentRouting
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixir.Settings.Setting

  setup do
    Repo.delete_all(Setting)
    on_exit(fn -> Repo.delete_all(Setting) end)
    :ok
  end

  describe "resolve/3 chain" do
    test "task label wins over project and user" do
      assert AgentPreference.resolve(["symphony:claude"], "codex", "codex") == "claude"
      assert AgentPreference.resolve(["Symphony:Codex"], "claude", "claude") == "codex"
      assert AgentPreference.resolve(["symphony:cursor"], "codex", "codex") == "cursor"
    end

    test "project explicit wins over user when no task label" do
      assert AgentPreference.resolve(["symphony"], "claude", "codex") == "claude"
      assert AgentPreference.resolve([], "codex", "claude") == "codex"
    end

    test "user default applies when task and project are silent" do
      assert AgentPreference.resolve([], nil, "claude") == "claude"
    end

    test "falls back to codex when everything is silent or invalid" do
      assert AgentPreference.resolve([], nil, nil) == "codex"
      assert AgentPreference.resolve([], "gemini", "gemini") == "codex"
    end

    test "claude label wins when both agent labels are present" do
      assert AgentPreference.resolve(["symphony:codex", "symphony:claude"], nil, nil) == "claude"
    end

    test "resolve/2 reads the user default from Settings" do
      {:ok, _} = Settings.put("agents", "default_agent_kind", "claude")
      assert AgentPreference.resolve([], nil) == "claude"
    end
  end

  describe "normalize/1" do
    test "passes valid kinds and nils everything else" do
      assert AgentPreference.normalize("codex") == "codex"
      assert AgentPreference.normalize("claude") == "claude"
      assert AgentPreference.normalize("cursor") == "cursor"
      assert AgentPreference.normalize(:claude) == nil
      assert AgentPreference.normalize("gemini") == nil
      assert AgentPreference.normalize(nil) == nil
    end
  end

  describe "AgentRouting.label_agent_kind/1" do
    test "returns the explicit agent label kind, nil otherwise" do
      assert AgentRouting.label_agent_kind(["bug", "symphony:claude"]) == "claude"
      assert AgentRouting.label_agent_kind(["symphony:codex"]) == "codex"
      assert AgentRouting.label_agent_kind(["symphony"]) == nil
      assert AgentRouting.label_agent_kind([]) == nil
    end
  end

  describe "AgentRouting.routable?/1 (admission no longer gates on configured kinds)" do
    test "any admission label routes" do
      assert AgentRouting.routable?(["symphony"])
      assert AgentRouting.routable?(["symphony:claude"])
      refute AgentRouting.routable?(["bug"])
    end

    test "empty list and mixed case" do
      refute AgentRouting.routable?([])
      assert AgentRouting.routable?(["SYMPHONY"])
    end
  end
end
