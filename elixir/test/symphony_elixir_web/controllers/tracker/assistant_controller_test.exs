defmodule SymphonyElixirWeb.Tracker.AssistantControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()

    previous_token = System.get_env(@token_env)
    previous_catalog = Application.get_env(:symphony_elixir, :assistant_codex_catalog)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_app_env(:assistant_codex_catalog, previous_catalog)
    end)

    {:ok, _project} =
      SymphonyElixir.LocalTracker.Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    Application.put_env(:symphony_elixir, :assistant_codex_catalog, %{
      agent: "codex",
      agent_label: "Codex CLI",
      command: "codex --model gpt-5.3-codex app-server",
      default_model: "gpt-5.3-codex",
      models: [
        %{
          id: "gpt-5.3-codex",
          model: "gpt-5.3-codex",
          label: "GPT-5.3 Codex",
          is_default: true,
          default_effort: "low",
          efforts: [%{id: "low", label: "Low"}]
        }
      ]
    })

    :ok
  end

  test "returns multi-agent catalog bundle for assistant config" do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/macro-markets/assistant/config")

    assert %{
             "data" => %{
               "agents" => agents,
               "default_agent" => default_agent
             }
           } = json_response(conn, 200)

    assert is_list(agents)
    assert is_binary(default_agent)

    codex = Enum.find(agents, &(&1["agent"] == "codex"))
    assert codex["agent_label"] == "Codex CLI"
    assert codex["command"] == "codex --model gpt-5.3-codex app-server"
    assert codex["default_model"] == "gpt-5.3-codex"
    assert [model] = codex["models"]
    assert model["model"] == "gpt-5.3-codex"
    assert model["label"] == "GPT-5.3 Codex"

    claude = Enum.find(agents, &(&1["agent"] == "claude"))
    assert claude["agent_label"] == "Claude Code"
    assert is_binary(claude["command"])
    assert claude["default_model"] == "claude-opus-4-8"
    assert length(claude["models"]) == 5

    default_claude_model = Enum.find(claude["models"], & &1["is_default"])
    assert default_claude_model["model"] == "claude-opus-4-8"
    assert Enum.any?(default_claude_model["efforts"], &(&1["id"] == "xhigh"))
  end

  defp migrate_repo do
    alias SymphonyElixir.Repo

    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp restore_env(key, value) do
    case value do
      nil -> System.delete_env(key)
      val -> System.put_env(key, val)
    end
  end

  defp restore_app_env(key, value) do
    case value do
      nil -> Application.delete_env(:symphony_elixir, key)
      val -> Application.put_env(:symphony_elixir, key, val)
    end
  end
end
