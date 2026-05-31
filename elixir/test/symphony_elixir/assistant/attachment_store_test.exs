defmodule SymphonyElixir.Assistant.AttachmentStoreTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{AttachmentStore, Payload}
  alias SymphonyElixir.LocalTracker.Context

  setup do
    tmp_dir = Path.join(System.tmp_dir!(), "symphony-assistant-upload-#{System.unique_integer([:positive])}")
    File.mkdir_p!(tmp_dir)
    Application.put_env(:symphony_elixir, :workspace_root, tmp_dir)

    on_exit(fn ->
      File.rm_rf!(tmp_dir)
      Application.delete_env(:symphony_elixir, :workspace_root)
    end)

    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    :ok
  end

  test "stores uploaded images and feeds Codex localImage input" do
    source = Path.join(System.tmp_dir!(), "diagram-#{System.unique_integer([:positive])}.png")
    File.write!(source, <<137, 80, 78, 71>>)

    upload = %Plug.Upload{
      path: source,
      filename: "diagram.png",
      content_type: "image/png"
    }

    assert {:ok, stored} = AttachmentStore.store_image("macro-markets", upload)
    assert stored["path"] =~ "uploads/"
    assert File.exists?(Path.join(AttachmentStore.uploads_dir(stored_path_workspace("macro-markets")), Path.basename(stored["path"])))

    normalized = Payload.normalize_attachments([stored], "macro-markets")
    assert normalized != []

    [text, image] = Payload.turn_input_items("Describe this image", normalized)
    assert text["type"] == "text"
    assert image == %{"type" => "localImage", "path" => stored["path"]}
  end

  defp stored_path_workspace(project_slug) do
    {:ok, workspace} = SymphonyElixir.Assistant.CodexSession.assistant_workspace(project_slug)
    workspace
  end
end
