defmodule SymphonyElixir.AgentModelTest do
  # async: false — the codex catalog is injected via application env.
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentModel

  setup do
    catalog = %{
      agent: "codex",
      agent_label: "Codex CLI",
      command: "codex",
      default_model: "gpt-5.5",
      models: [
        %{id: "gpt-5.5", model: "gpt-5.5", label: "GPT-5.5", is_default: true, default_effort: "medium", efforts: []},
        %{id: "gpt-5-codex", model: "gpt-5-codex", label: "GPT-5 Codex", is_default: false, default_effort: "medium", efforts: []}
      ]
    }

    Application.put_env(:symphony_elixir, :assistant_codex_catalog, catalog)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :assistant_codex_catalog) end)
    :ok
  end

  test "accepts a model present in the codex catalog" do
    assert AgentModel.validate("codex", "gpt-5.5") == :ok
  end

  test "accepts the curated Codex fallback when live discovery is unavailable" do
    Application.delete_env(:symphony_elixir, :assistant_codex_catalog)

    assert AgentModel.validate("codex", "gpt-5.6-sol") == :ok
  end

  test "accepts a blank or nil model (CLI default)" do
    assert AgentModel.validate("codex", nil) == :ok
    assert AgentModel.validate("codex", "") == :ok
    assert AgentModel.validate("codex", "   ") == :ok
  end

  test "rejects an unknown codex model and reports the valid models" do
    assert {:error, %{agent_kind: "codex", model: "gpt-5.2-codex", valid_models: valid}} =
             AgentModel.validate("codex", "gpt-5.2-codex")

    assert "gpt-5.5" in valid
    assert "gpt-5-codex" in valid
  end

  test "fails open for an unknown agent kind" do
    assert AgentModel.validate("mystery-agent", "whatever") == :ok
  end
end
