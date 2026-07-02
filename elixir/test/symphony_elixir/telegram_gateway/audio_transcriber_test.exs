defmodule SymphonyElixir.TelegramGateway.AudioTranscriberTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.TelegramGateway.AudioTranscriber

  test "transcribes audio locally with ffmpeg and whisper.cpp when configured" do
    calls = Agent.start_link(fn -> [] end) |> elem(1)

    system_cmd = fn command, args, _opts ->
      Agent.update(calls, &[{command, args} | &1])

      if command == "/usr/local/bin/whisper-cli" do
        out_base =
          args
          |> Enum.chunk_every(2, 1, :discard)
          |> Enum.find_value(fn
            ["-of", value] -> value
            _ -> nil
          end)

        File.write!(out_base <> ".txt", "transcrição local\n")
      end

      {"", 0}
    end

    assert {:ok, "transcrição local"} =
             AudioTranscriber.transcribe_message(
               %{"voice" => %{"file_id" => "voice-1", "mime_type" => "audio/ogg"}},
               get_file: fn "voice-1" -> {:ok, %{"result" => %{"file_path" => "voice/file.oga"}}} end,
               download_file: fn "voice/file.oga" -> {:ok, "audio-bytes"} end,
               env: %{
                 "SYMPHONY_WHISPER_CPP_BIN" => "/usr/local/bin/whisper-cli",
                 "SYMPHONY_WHISPER_MODEL" => "/models/ggml-small.bin",
                 "SYMPHONY_FFMPEG_BIN" => "/usr/bin/ffmpeg"
               },
               system_cmd: system_cmd
             )

    commands = Agent.get(calls, &Enum.map(&1, fn {command, _args} -> command end))
    assert "/usr/local/bin/whisper-cli" in commands
    assert "/usr/bin/ffmpeg" in commands
  end

  test "uses an extended timeout when downloading Telegram audio files" do
    parent = self()

    req = %{
      get: fn url, opts ->
        send(parent, {:download, url, opts})
        {:ok, %{status: 200, body: "audio-bytes"}}
      end
    }

    assert {:ok, "ok"} =
             AudioTranscriber.transcribe_message(
               %{"voice" => %{"file_id" => "voice-1", "mime_type" => "audio/ogg"}},
               get_file: fn "voice-1" -> {:ok, %{"result" => %{"file_path" => "voice/file.oga"}}} end,
               token: "test-token",
               req: req,
               transcribe: fn "audio-bytes", "voice/file.oga" -> {:ok, "ok"} end
             )

    assert_receive {:download, url, opts}
    assert url =~ "/file/bot"
    assert opts[:receive_timeout] >= 120_000
  end
end
