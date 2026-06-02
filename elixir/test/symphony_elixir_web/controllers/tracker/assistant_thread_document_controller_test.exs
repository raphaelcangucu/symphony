defmodule SymphonyElixirWeb.Tracker.AssistantThreadDocumentControllerTest do
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
    clean_threads()

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    workspace = Path.join(System.tmp_dir!(), "thread-doc-controller-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    File.write!(Path.join(workspace, "draft.md"), "# Draft\n\ncontent")

    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Docs",
        workspace_path: workspace
      })

    on_exit(fn ->
      clean_threads()
      restore_env(@token_env, previous_token)
      File.rm_rf!(workspace)
    end)

    %{thread: thread}
  end

  test "lists thread documents", %{thread: thread} do
    conn = get(authorize(), documents_path(thread.id))

    assert %{
             "data" => %{
               "available" => true,
               "documents" => [%{"path" => "draft.md", "kind" => "draft", "title" => "Draft"}]
             }
           } = json_response(conn, 200)
  end

  test "reads a thread document", %{thread: thread} do
    conn = get(authorize(), "#{documents_path(thread.id)}/draft.md")

    assert %{"data" => %{"path" => "draft.md", "content" => "# Draft\n\ncontent"}} = json_response(conn, 200)
  end

  test "rejects invalid thread ids" do
    conn = get(authorize(), "/api/tracker/v1/assistant/threads/0/documents")

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  defp documents_path(thread_id), do: "/api/tracker/v1/assistant/threads/#{thread_id}/documents"

  defp authorize do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_threads do
    Repo.delete_all(SymphonyElixir.Assistant.Message)
    Repo.delete_all(SymphonyElixir.Assistant.Thread)
  end

  defp restore_env(key, previous) do
    case previous do
      nil -> System.delete_env(key)
      value -> System.put_env(key, value)
    end
  end
end
