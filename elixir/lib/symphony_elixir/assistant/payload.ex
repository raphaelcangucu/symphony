defmodule SymphonyElixir.Assistant.Payload do
  @moduledoc "Normalizes assistant channel payloads for Codex turns and persisted metadata."

  @max_image_bytes 4 * 1024 * 1024
  @max_audio_bytes 8 * 1024 * 1024

  # Stable tracker API prefix (see SymphonyElixirWeb.Router). Used to build the
  # embeddable attachment URL the agent can drop into issue descriptions,
  # comments, and documents so the tracker UI renders the file.
  @api_prefix "/api/tracker/v1"

  @spec normalize_attachments(term(), String.t()) :: [map()]
  def normalize_attachments(attachments, project_slug) when is_list(attachments) and is_binary(project_slug) do
    attachments
    |> Enum.flat_map(&normalize_attachment(&1, project_slug))
    |> Enum.take(8)
  end

  def normalize_attachments(_attachments, _project_slug), do: []

  @spec enrich_message(String.t(), [map()]) :: String.t()
  def enrich_message(message, attachments) when is_binary(message) and is_list(attachments) do
    notes =
      attachments
      |> Enum.flat_map(&attachment_note/1)
      |> Enum.reject(&(&1 == ""))

    case notes do
      [] -> message
      _ -> String.trim("#{message}\n\n#{Enum.join(notes, "\n")}")
    end
  end

  @spec turn_input_items(String.t(), [map()]) :: [map()]
  def turn_input_items(prompt, attachments) when is_binary(prompt) and is_list(attachments) do
    image_items =
      attachments
      |> Enum.flat_map(fn
        %{"type" => "image", "path" => path} when is_binary(path) ->
          [%{"type" => "localImage", "path" => path}]

        %{"type" => "image", "media_type" => media_type, "data" => data} = attachment ->
          case image_data_url(media_type, data, Map.get(attachment, "name")) do
            {:ok, url} -> [%{"type" => "image", "url" => url}]
            :error -> []
          end

        _ ->
          []
      end)

    [%{"type" => "text", "text" => prompt}] ++ image_items
  end

  @spec model_opts(map()) :: keyword()
  def model_opts(context) when is_map(context) do
    []
    |> maybe_put(:model, pick_string(context, ["model", :model]))
    |> maybe_put(:effort, pick_string(context, ["effort", :effort]))
    |> maybe_put(:execution_mode, pick_string(context, ["execution_mode", :execution_mode]))
  end

  defp normalize_attachment(%{"type" => "image", "path" => path} = attachment, project_slug)
       when is_binary(path) and is_binary(project_slug) do
    alias SymphonyElixir.Assistant.AttachmentStore

    with {:ok, _absolute} <- AttachmentStore.resolve_path(project_slug, path),
         {:ok, name} <- required_string(attachment, ["name", :name], "image"),
         {:ok, media_type} <- required_string(attachment, ["media_type", :media_type], "image/png") do
      [
        %{
          "type" => "image",
          "name" => name,
          "media_type" => media_type,
          "path" => path,
          "url" => attachment_url(project_slug, path)
        }
      ]
    else
      _ -> []
    end
  end

  defp normalize_attachment(%{"type" => "image"} = attachment, project_slug) when is_binary(project_slug) do
    with {:ok, name} <- required_string(attachment, ["name", :name], "image"),
         {:ok, media_type} <- required_string(attachment, ["media_type", :media_type], "image/png"),
         {:ok, data} <- required_base64(attachment, @max_image_bytes) do
      [%{"type" => "image", "name" => name, "media_type" => media_type, "data" => data}]
    else
      _ -> []
    end
  end

  defp normalize_attachment(%{"type" => "file", "path" => path} = attachment, project_slug)
       when is_binary(path) and is_binary(project_slug) do
    alias SymphonyElixir.Assistant.AttachmentStore

    with {:ok, _absolute} <- AttachmentStore.resolve_path(project_slug, path),
         {:ok, name} <- required_string(attachment, ["name", :name], "file"),
         {:ok, media_type} <- required_string(attachment, ["media_type", :media_type], "application/octet-stream") do
      base = %{
        "type" => "file",
        "name" => name,
        "media_type" => media_type,
        "path" => path,
        "url" => attachment_url(project_slug, path)
      }

      case AttachmentStore.read_text(project_slug, path) do
        {:ok, text, truncated?} -> [Map.merge(base, %{"text" => text, "truncated" => truncated?})]
        {:error, _reason} -> [base]
      end
    else
      _ -> []
    end
  end

  defp normalize_attachment(%{"type" => "audio"} = attachment, _project_slug) do
    with {:ok, name} <- required_string(attachment, ["name", :name], "recording.webm"),
         {:ok, media_type} <- required_string(attachment, ["media_type", :media_type], "audio/webm"),
         {:ok, data} <- required_base64(attachment, @max_audio_bytes) do
      [
        %{
          "type" => "audio",
          "name" => name,
          "media_type" => media_type,
          "data" => data,
          "transcript" => pick_string(attachment, ["transcript", :transcript])
        }
      ]
    else
      _ -> []
    end
  end

  defp normalize_attachment(_attachment, _project_slug), do: []

  @spec attachment_summary([map()]) :: [map()]
  def attachment_summary(attachments) when is_list(attachments) do
    Enum.map(attachments, fn
      %{"type" => "image"} = attachment ->
        %{
          "type" => "image",
          "name" => Map.get(attachment, "name"),
          "media_type" => Map.get(attachment, "media_type"),
          "path" => Map.get(attachment, "path")
        }

      %{"type" => "audio"} = attachment ->
        %{
          "type" => "audio",
          "name" => Map.get(attachment, "name"),
          "media_type" => Map.get(attachment, "media_type")
        }

      %{"type" => "file"} = attachment ->
        %{
          "type" => "file",
          "name" => Map.get(attachment, "name"),
          "media_type" => Map.get(attachment, "media_type"),
          "path" => Map.get(attachment, "path")
        }

      _ ->
        %{}
    end)
  end

  defp attachment_note(%{"type" => "image", "name" => name, "url" => url}) when is_binary(url) do
    [
      "Attached image \"#{name}\" (already saved in this project). " <>
        "To show it in an issue description, comment, or document, embed it with this exact Markdown " <>
        "(keep the URL unchanged): ![#{markdown_alt(name)}](#{url})"
    ]
  end

  defp attachment_note(%{"type" => "image", "name" => name}), do: ["Attached image: #{name}"]
  defp attachment_note(%{"type" => "image"}), do: ["Attached image"]

  defp attachment_note(%{"type" => "file", "name" => name, "text" => text} = attachment)
       when is_binary(text) and text != "" do
    suffix = if Map.get(attachment, "truncated") == true, do: "\n[... file truncated ...]", else: ""
    link = file_link_hint(name, Map.get(attachment, "url"))

    ["Attached file `#{name}`#{link}:\n<<<BEGIN FILE #{name}>>>\n#{text}#{suffix}\n<<<END FILE #{name}>>>"]
  end

  defp attachment_note(%{"type" => "file", "name" => name} = attachment) do
    link = file_link_hint(name, Map.get(attachment, "url"))
    ["Attached file: #{name} (binary)#{link}."]
  end

  defp attachment_note(%{"type" => "file"}), do: ["Attached file"]

  defp attachment_note(%{"type" => "audio", "name" => name, "transcript" => transcript})
       when is_binary(transcript) and transcript != "" do
    ["Audio note (#{name}): #{transcript}"]
  end

  defp attachment_note(%{"type" => "audio", "name" => name}), do: ["Audio attachment: #{name} (transcription unavailable)."]
  defp attachment_note(_attachment), do: []

  defp file_link_hint(_name, url) when is_binary(url) and url != "" do
    " (saved in this project; link it in Markdown with the exact URL #{url})"
  end

  defp file_link_hint(_name, _url), do: ""

  defp markdown_alt(name) when is_binary(name), do: String.replace(name, ["[", "]"], "")
  defp markdown_alt(_name), do: "image"

  # Builds the root-relative tracker API URL that serves a stored attachment.
  # The tracker UI Markdown renderer resolves these (with auth) into images.
  defp attachment_url(project_slug, path) when is_binary(project_slug) and is_binary(path) do
    encoded_path =
      path
      |> String.split("/", trim: true)
      |> Enum.map_join("/", fn segment -> URI.encode(segment, &URI.char_unreserved?/1) end)

    slug = URI.encode(project_slug, &URI.char_unreserved?/1)
    "#{@api_prefix}/projects/#{slug}/assistant/attachments/#{encoded_path}"
  end

  defp image_data_url(media_type, data, name) do
    cond do
      String.starts_with?(data, "data:") ->
        {:ok, data}

      valid_base64?(data) ->
        {:ok, "data:#{media_type};base64,#{data}"}

      true ->
        _ = name
        :error
    end
  end

  defp required_string(map, keys, default) do
    case pick_string(map, keys) do
      value when is_binary(value) and value != "" -> {:ok, value}
      _ -> {:ok, default}
    end
  end

  defp required_base64(map, max_bytes) do
    case pick_string(map, ["data", :data]) do
      data when is_binary(data) ->
        payload = strip_data_url(data)

        if valid_base64?(payload) do
          case Base.decode64(payload) do
            {:ok, decoded} when byte_size(decoded) <= max_bytes -> {:ok, payload}
            {:ok, _} -> :error
            :error -> :error
          end
        else
          :error
        end

      _ ->
        :error
    end
  end

  defp strip_data_url(data) do
    case String.split(data, ",", parts: 2) do
      [_prefix, payload] -> payload
      _ -> data
    end
  end

  defp valid_base64?(data) when is_binary(data) do
    case Base.decode64(data, padding: false) do
      {:ok, _} -> true
      :error -> Base.decode64(data) != :error
    end
  end

  defp pick_string(map, keys) when is_map(map) do
    Enum.find_value(keys, fn
      key when is_binary(key) ->
        case Map.get(map, key) do
          value when is_binary(value) -> value
          _ -> nil
        end

      key when is_atom(key) ->
        case Map.get(map, key) || Map.get(map, Atom.to_string(key)) do
          value when is_binary(value) -> value
          _ -> nil
        end

      _ ->
        nil
    end)
  end

  defp maybe_put(opts, _key, nil), do: opts
  defp maybe_put(opts, _key, ""), do: opts
  defp maybe_put(opts, key, value), do: Keyword.put(opts, key, value)
end
