defmodule SymphonyElixirWeb.Tracker.AssistantThreadFileControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    Repo.delete_all(SymphonyElixir.Assistant.Message)
    Repo.delete_all(SymphonyElixir.Assistant.Thread)
    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    workspace = Path.join(System.tmp_dir!(), "thread-files-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(workspace, "src"))
    File.mkdir_p!(Path.join(workspace, "assets"))
    File.write!(Path.join(workspace, "src/app.ts"), "export const app = true;\n")
    File.write!(Path.join(workspace, "README.md"), "# Workspace\n")
    File.write!(Path.join(workspace, "assets/icon.png"), <<137, 80, 78, 71, 13, 10, 26, 10>>)

    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Files",
        workspace_path: workspace
      })

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      File.rm_rf!(workspace)
    end)

    %{thread: thread}
  end

  test "lists source, markdown and image files", %{thread: thread} do
    conn = get(authorize(), files_path(thread.id))
    paths = conn |> json_response(200) |> get_in(["data", "files"]) |> Enum.map(& &1["path"])

    assert "src/app.ts" in paths
    assert "README.md" in paths
    assert "assets/icon.png" in paths
  end

  test "reads text and base64 image content", %{thread: thread} do
    text = get(authorize(), "#{files_path(thread.id)}/src/app.ts")
    image = get(authorize(), "#{files_path(thread.id)}/assets/icon.png")

    assert %{"data" => %{"kind" => "text", "content" => "export const app = true;\n"}} =
             json_response(text, 200)

    assert %{
             "data" => %{
               "kind" => "image",
               "mime_type" => "image/png",
               "content_base64" => encoded
             }
           } = json_response(image, 200)

    assert Base.decode64!(encoded) == <<137, 80, 78, 71, 13, 10, 26, 10>>
  end

  test "rejects parent traversal", %{thread: thread} do
    conn = get(authorize(), "#{files_path(thread.id)}/%2E%2E/secret.env")
    assert %{"error" => %{"code" => "invalid_workspace_file_path"}} = json_response(conn, 422)
  end

  defp files_path(thread_id), do: "/api/tracker/v1/assistant/threads/#{thread_id}/files"

  defp authorize do
    build_conn() |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
