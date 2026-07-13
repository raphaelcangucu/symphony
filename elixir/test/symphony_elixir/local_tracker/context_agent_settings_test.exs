defmodule SymphonyElixir.LocalTracker.ContextAgentSettingsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.IssueAgentSettings
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    Repo.delete_all(IssueAgentSettings)
    :ok
  end

  test "put_agent_settings then get_agent_settings round-trips" do
    :ok =
      Context.put_agent_settings("demo", "DEMO-1", %{
        model: "gpt-5.5",
        effort: "high",
        mode: "build",
        agent_kind: "codex"
      })

    assert {:ok, settings} = Context.get_agent_settings("demo", "DEMO-1")
    assert settings.model == "gpt-5.5"
    assert settings.effort == "high"
    assert settings.mode == "build"
    assert settings.agent_kind == "codex"
  end

  test "get_agent_settings returns :not_found when absent" do
    assert Context.get_agent_settings("demo", "MISSING") == {:error, :not_found}
  end

  test "put_agent_settings upserts the existing row in place" do
    :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: "gpt-5.4", mode: "plan"})
    :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: "gpt-5.5", mode: "yolo"})

    assert Repo.aggregate(IssueAgentSettings, :count) == 1
    assert {:ok, settings} = Context.get_agent_settings("demo", "DEMO-1")
    assert settings.model == "gpt-5.5"
    assert settings.mode == "yolo"
  end

  test "put_agent_settings preserves prior values for omitted keys" do
    :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: "gpt-5.5", effort: "high", mode: "build"})
    :ok = Context.put_agent_settings("demo", "DEMO-1", %{mode: "yolo"})

    assert {:ok, settings} = Context.get_agent_settings("demo", "DEMO-1")
    assert settings.mode == "yolo"
    assert settings.model == "gpt-5.5"
    assert settings.effort == "high"
  end

  test "put_agent_settings drops nil and blank values" do
    :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: "gpt-5.5", effort: nil, mode: "  "})

    assert {:ok, settings} = Context.get_agent_settings("demo", "DEMO-1")
    assert settings.model == "gpt-5.5"
    assert settings.effort == nil
    assert settings.mode == nil
  end

  test "put_agent_settings accepts string keys" do
    :ok = Context.put_agent_settings("demo", "DEMO-1", %{"model" => "gpt-5.5", "mode" => "plan"})

    assert {:ok, settings} = Context.get_agent_settings("demo", "DEMO-1")
    assert settings.model == "gpt-5.5"
    assert settings.mode == "plan"
  end

  test "put_agent_settings clears a field when attrs has explicit nil" do
    :ok =
      Context.put_agent_settings("demo", "DEMO-1", %{
        agent_kind: "codex",
        model: "gpt-5.5",
        effort: "high"
      })

    :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: nil})

    assert {:ok, settings} = Context.get_agent_settings("demo", "DEMO-1")
    assert settings.agent_kind == "codex"
    assert settings.model == nil
    assert settings.effort == "high"
  end

  test "put_agent_settings preserves omitted keys" do
    :ok = Context.put_agent_settings("demo", "DEMO-1", %{model: "gpt-5.5", effort: "high"})
    :ok = Context.put_agent_settings("demo", "DEMO-1", %{effort: "xhigh"})

    assert {:ok, settings} = Context.get_agent_settings("demo", "DEMO-1")
    assert settings.model == "gpt-5.5"
    assert settings.effort == "xhigh"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
