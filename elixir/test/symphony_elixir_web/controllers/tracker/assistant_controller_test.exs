defmodule SymphonyElixirWeb.Tracker.AssistantControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.AttachmentStore

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()

    previous_token = System.get_env(@token_env)
    previous_catalog = Application.get_env(:symphony_elixir, :assistant_codex_catalog)
    previous_workspace_root = Application.get_env(:symphony_elixir, :workspace_root)
    System.put_env(@token_env, "secret")

    workspace_root = Path.join(System.tmp_dir!(), "symphony-assistant-controller-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace_root)
    Application.put_env(:symphony_elixir, :workspace_root, workspace_root)

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_app_env(:assistant_codex_catalog, previous_catalog)
      restore_app_env(:workspace_root, previous_workspace_root)
      File.rm_rf!(workspace_root)
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

  test "serves a stored attachment image with the right content type" do
    stored = store_png_attachment()

    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/macro-markets/assistant/attachments/#{stored["path"]}")

    assert conn.status == 200
    assert [content_type] = get_resp_header(conn, "content-type")
    assert content_type =~ "image/png"
    assert conn.resp_body == <<137, 80, 78, 71>>
  end

  test "serves a stored markdown file as text" do
    stored = store_markdown_attachment()

    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/macro-markets/assistant/attachments/#{stored["path"]}")

    assert conn.status == 200
    assert [content_type] = get_resp_header(conn, "content-type")
    assert content_type =~ "text/markdown"
    assert conn.resp_body == "# Notes\n"
  end

  test "returns 404 for a missing attachment" do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/macro-markets/assistant/attachments/uploads/does-not-exist.png")

    assert %{"error" => %{"code" => "attachment_not_found"}} = json_response(conn, 404)
  end

  test "does not serve attachment paths that escape the uploads directory" do
    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer secret")
      |> get("/api/tracker/v1/projects/macro-markets/assistant/attachments/uploads/../secrets.png")

    assert %{"error" => %{"code" => "attachment_not_found"}} = json_response(conn, 404)
  end

  test "rejects unauthenticated attachment requests" do
    stored = store_png_attachment()

    conn = get(build_conn(), "/api/tracker/v1/projects/macro-markets/assistant/attachments/#{stored["path"]}")

    assert json_response(conn, 401)
  end

  defp store_png_attachment do
    source = Path.join(System.tmp_dir!(), "diagram-#{System.unique_integer([:positive])}.png")
    File.write!(source, <<137, 80, 78, 71>>)

    upload = %Plug.Upload{path: source, filename: "diagram.png", content_type: "image/png"}
    {:ok, stored} = AttachmentStore.store_image("macro-markets", upload)
    stored
  end

  defp store_markdown_attachment do
    source = Path.join(System.tmp_dir!(), "notes-#{System.unique_integer([:positive])}.md")
    File.write!(source, "# Notes\n")

    upload = %Plug.Upload{path: source, filename: "notes.md", content_type: "text/markdown"}
    {:ok, stored} = AttachmentStore.store_file("macro-markets", upload)
    stored
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
