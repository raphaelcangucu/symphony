defmodule SymphonyElixir.TelegramGateway.AudioTranscriber do
  @moduledoc "Downloads Telegram audio files and transcribes them with OpenAI's audio API."

  alias SymphonyElixir.Settings.Credentials
  alias SymphonyElixir.TelegramGateway.Client

  @openai_url "https://api.openai.com/v1/audio/transcriptions"

  @spec transcribe_message(map(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def transcribe_message(message, opts \\ []) when is_map(message) and is_list(opts) do
    with {:ok, audio} <- audio_payload(message),
         {:ok, file_path} <- telegram_file_path(audio.file_id, opts),
         {:ok, bytes} <- download_telegram_file(file_path, opts),
         {:ok, transcript} <- transcribe_bytes(bytes, file_path, opts) do
      {:ok, transcript}
    end
  end

  @spec audio_payload(map()) :: {:ok, map()} | {:error, :audio_not_found}
  def audio_payload(%{"voice" => %{"file_id" => file_id} = voice}) when is_binary(file_id) do
    {:ok, %{kind: "voice", file_id: file_id, mime_type: Map.get(voice, "mime_type")}}
  end

  def audio_payload(%{"audio" => %{"file_id" => file_id} = audio}) when is_binary(file_id) do
    {:ok, %{kind: "audio", file_id: file_id, mime_type: Map.get(audio, "mime_type")}}
  end

  def audio_payload(_message), do: {:error, :audio_not_found}

  defp telegram_file_path(file_id, opts) do
    get_file = Keyword.get(opts, :get_file, fn id -> Client.call("getFile", %{"file_id" => id}) end)

    case get_file.(file_id) do
      {:ok, %{"result" => %{"file_path" => path}}} when is_binary(path) -> {:ok, path}
      {:error, reason} -> {:error, reason}
      other -> {:error, {:unexpected_get_file_response, other}}
    end
  end

  defp download_telegram_file(file_path, opts) do
    download_file = Keyword.get(opts, :download_file)

    cond do
      is_function(download_file, 1) -> download_file.(file_path)
      true -> default_download_file(file_path, opts)
    end
  end

  defp default_download_file(file_path, opts) do
    req = Keyword.get(opts, :req, Req)

    with {:ok, token} <- telegram_token(opts),
         {:ok, %{status: status, body: body}} when status in 200..299 <-
           req_get(req, "https://api.telegram.org/file/bot#{token}/#{file_path}",
             receive_timeout: 120_000,
             connect_options: [timeout: 30_000]
           ) do
      {:ok, body}
    else
      {:ok, response} -> {:error, {:telegram_file_download_failed, response.status}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp req_get(req, url, opts) when is_atom(req), do: req.get(url, opts)

  defp req_get(%{get: get}, url, opts) when is_function(get, 2), do: get.(url, opts)

  defp transcribe_bytes(bytes, file_path, opts) do
    transcribe = Keyword.get(opts, :transcribe)

    cond do
      is_function(transcribe, 2) -> transcribe.(bytes, file_path)
      is_function(transcribe, 3) -> transcribe.(bytes, file_path, opts)
      true -> default_transcribe(bytes, file_path, opts)
    end
  end

  defp default_transcribe(bytes, file_path, opts) when is_binary(bytes) do
    case local_whisper_transcribe(bytes, file_path, opts) do
      {:ok, transcript} -> {:ok, transcript}
      {:error, :local_transcription_unavailable} -> openai_transcribe(bytes, file_path)
      {:error, reason} -> {:error, reason}
    end
  end

  defp local_whisper_transcribe(bytes, file_path, opts) do
    env = Keyword.get(opts, :env, System.get_env())
    whisper_bin = Map.get(env, "SYMPHONY_WHISPER_CPP_BIN")
    model_path = Map.get(env, "SYMPHONY_WHISPER_MODEL")
    ffmpeg_bin = Map.get(env, "SYMPHONY_FFMPEG_BIN") || "ffmpeg"
    system_cmd = Keyword.get(opts, :system_cmd, &System.cmd/3)

    cond do
      not present?(whisper_bin) or not present?(model_path) ->
        {:error, :local_transcription_unavailable}

      true ->
        with {:ok, input_path} <- write_temp_audio(bytes, file_path),
             wav_path = input_path <> ".wav",
             out_base = input_path <> ".whisper",
             :ok <- run_cmd(system_cmd, ffmpeg_bin, ["-y", "-i", input_path, "-ar", "16000", "-ac", "1", wav_path]),
             :ok <- run_cmd(system_cmd, whisper_bin, ["-m", model_path, "-f", wav_path, "-otxt", "-of", out_base]),
             {:ok, transcript} <- read_local_transcript(out_base <> ".txt") do
          File.rm(input_path)
          File.rm(wav_path)
          File.rm(out_base <> ".txt")
          {:ok, transcript}
        end
    end
  end

  defp openai_transcribe(bytes, file_path) do
    with {:ok, api_key} <- openai_api_key(),
         {:ok, tmp_path} <- write_temp_audio(bytes, file_path),
         {:ok, response} <-
           Req.post(@openai_url,
             auth: {:bearer, api_key},
             multipart: [file: {:file, tmp_path}, model: "whisper-1"]
           ) do
      File.rm(tmp_path)
      normalize_openai_response(response)
    end
  end

  defp run_cmd(system_cmd, command, args) do
    case system_cmd.(command, args, stderr_to_stdout: true) do
      {_output, 0} -> :ok
      {output, status} -> {:error, {:command_failed, command, status, output}}
    end
  rescue
    error -> {:error, error}
  end

  defp read_local_transcript(path) do
    case File.read(path) do
      {:ok, text} ->
        case String.trim(text) do
          "" -> {:error, :empty_transcript}
          transcript -> {:ok, transcript}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp normalize_openai_response(%{status: status, body: %{"text" => text}}) when status in 200..299 and is_binary(text),
    do: {:ok, String.trim(text)}

  defp normalize_openai_response(%{status: status, body: body}), do: {:error, {:openai_transcription_failed, status, body}}

  defp write_temp_audio(bytes, file_path) do
    path = Path.join(System.tmp_dir!(), "symphony-telegram-audio-#{System.unique_integer([:positive])}-#{Path.basename(file_path)}")

    case File.write(path, bytes) do
      :ok -> {:ok, path}
      {:error, reason} -> {:error, reason}
    end
  end

  defp telegram_token(opts) do
    case Keyword.get(opts, :token) || Credentials.get("telegram", "bot_token") do
      token when is_binary(token) and token != "" -> {:ok, token}
      _ -> {:error, :telegram_bot_token_missing}
    end
  end

  defp openai_api_key do
    case System.get_env("OPENAI_API_KEY") do
      key when is_binary(key) and key != "" -> {:ok, key}
      _ -> {:error, :openai_api_key_missing}
    end
  end

  defp present?(value) when is_binary(value), do: String.trim(value) != ""
  defp present?(_value), do: false
end
