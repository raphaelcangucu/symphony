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

  test "stores a markdown file and inlines its content into the prompt" do
    source = Path.join(System.tmp_dir!(), "notes-#{System.unique_integer([:positive])}.md")
    File.write!(source, "# Title\n\nHello from markdown.")

    upload = %Plug.Upload{path: source, filename: "notes.md", content_type: "text/markdown"}

    assert {:ok, stored} = AttachmentStore.store_file("macro-markets", upload)
    assert stored["type"] == "file"
    assert stored["name"] == "notes.md"
    assert stored["path"] =~ "uploads/"

    assert {:ok, "# Title\n\nHello from markdown.", false} =
             AttachmentStore.read_text("macro-markets", stored["path"])

    normalized = Payload.normalize_attachments([stored], "macro-markets")
    assert [%{"type" => "file", "name" => "notes.md", "text" => text}] = normalized
    assert text =~ "Hello from markdown."

    enriched = Payload.enrich_message("Review this", normalized)
    assert enriched =~ "Review this"
    assert enriched =~ "Attached file `notes.md`"
    assert enriched =~ "Hello from markdown."

    # Files do not add image turn items; the content is carried in the prompt text.
    assert [%{"type" => "text"}] = Payload.turn_input_items("Review this", normalized)

    # Persisted metadata stays lean (no inlined text).
    assert [summary] = Payload.attachment_summary(normalized)

    assert summary == %{
             "type" => "file",
             "name" => "notes.md",
             "media_type" => "text/markdown",
             "path" => stored["path"]
           }
  end

  test "image attachments expose an embeddable Markdown URL for the agent" do
    source = Path.join(System.tmp_dir!(), "shot-#{System.unique_integer([:positive])}.png")
    File.write!(source, <<137, 80, 78, 71>>)

    upload = %Plug.Upload{path: source, filename: "shot.png", content_type: "image/png"}
    {:ok, stored} = AttachmentStore.store_file("macro-markets", upload)

    [normalized] = Payload.normalize_attachments([stored], "macro-markets")
    expected_url = "/api/tracker/v1/projects/macro-markets/assistant/attachments/#{stored["path"]}"
    assert normalized["url"] == expected_url

    enriched = Payload.enrich_message("Create a task with this screenshot", [normalized])
    assert enriched =~ "Create a task with this screenshot"
    assert enriched =~ "![shot.png](#{expected_url})"
  end

  test "stores webm video uploads" do
    source = Path.join(System.tmp_dir!(), "clip-#{System.unique_integer([:positive])}.webm")
    File.write!(source, <<0x1A, 0x45, 0xDF, 0xA3>>)

    upload = %Plug.Upload{path: source, filename: "clip.webm", content_type: "video/webm"}

    assert {:ok, stored} = AttachmentStore.store_file("macro-markets", upload)
    assert stored["type"] == "file"
    assert stored["name"] == "clip.webm"
    assert stored["media_type"] == "video/webm"
    assert stored["path"] =~ "uploads/"
    assert stored["path"] =~ ".webm"
    assert {:error, :not_text} = AttachmentStore.read_text("macro-markets", stored["path"])
  end

  test "stores mp4 video uploads" do
    source = Path.join(System.tmp_dir!(), "clip-#{System.unique_integer([:positive])}.mp4")
    File.write!(source, <<0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70>>)

    upload = %Plug.Upload{path: source, filename: "clip.mp4", content_type: "video/mp4"}

    assert {:ok, stored} = AttachmentStore.store_file("macro-markets", upload)
    assert stored["type"] == "file"
    assert stored["name"] == "clip.mp4"
    assert stored["media_type"] == "video/mp4"
    assert stored["path"] =~ ".mp4"
    assert {:error, :not_text} = AttachmentStore.read_text("macro-markets", stored["path"])
  end

  test "rejects unsupported file types" do
    source = Path.join(System.tmp_dir!(), "binary-#{System.unique_integer([:positive])}.bin")
    File.write!(source, <<0, 1, 2, 3>>)

    upload = %Plug.Upload{path: source, filename: "payload.bin", content_type: "application/octet-stream"}

    assert {:error, :unsupported_file_type} = AttachmentStore.store_file("macro-markets", upload)
  end

  test "read_text returns :not_text for binary attachments" do
    source = Path.join(System.tmp_dir!(), "pic-#{System.unique_integer([:positive])}.png")
    File.write!(source, <<137, 80, 78, 71>>)

    upload = %Plug.Upload{path: source, filename: "pic.png", content_type: "image/png"}
    {:ok, stored} = AttachmentStore.store_file("macro-markets", upload)

    assert stored["type"] == "image"
    assert {:error, :not_text} = AttachmentStore.read_text("macro-markets", stored["path"])
  end

  defp stored_path_workspace(project_slug) do
    {:ok, workspace} = SymphonyElixir.Assistant.CodexSession.assistant_workspace(project_slug)
    workspace
  end
end
