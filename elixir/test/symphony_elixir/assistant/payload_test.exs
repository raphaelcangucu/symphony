defmodule SymphonyElixir.Assistant.PayloadTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.Payload

  test "normalizes image attachments and builds turn input" do
    data = Base.encode64(<<1, 2, 3>>)

    attachments = [
      %{
        "type" => "image",
        "name" => "diagram.png",
        "media_type" => "image/png",
        "data" => data
      }
    ]

    assert [%{"type" => "image", "name" => "diagram.png"}] =
             Payload.normalize_attachments(attachments, "macro-markets")

    [text, image] = Payload.turn_input_items("Describe this", attachments)
    assert text == %{"type" => "text", "text" => "Describe this"}
    assert image["type"] == "image"
    assert image["url"] == "data:image/png;base64,#{data}"
  end

  test "enriches messages with audio transcript notes" do
    attachments = [
      %{
        "type" => "audio",
        "name" => "note.webm",
        "media_type" => "audio/webm",
        "data" => Base.encode64(<<0>>),
        "transcript" => "Crie uma task"
      }
    ]

    message = Payload.enrich_message("Olá", attachments)
    assert message =~ "Olá"
    assert message =~ "Audio note (note.webm): Crie uma task"
  end

  test "model_opts extracts model and effort from context" do
    opts = Payload.model_opts(%{"model" => "gpt-5.3-codex", "effort" => "high"})
    assert Keyword.get(opts, :model) == "gpt-5.3-codex"
    assert Keyword.get(opts, :effort) == "high"
  end

  test "model_opts extracts execution_mode from context" do
    opts = Payload.model_opts(%{"execution_mode" => "plan"})
    assert Keyword.get(opts, :execution_mode) == "plan"
  end
end
