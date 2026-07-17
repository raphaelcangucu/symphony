defmodule SymphonyElixir.Agent.SessionStore do
  @moduledoc """
  Per-session Symphony-owned transcript files.

  Each session (any origin) writes to
  `<workspace>/.symphony/sessions/<session_id>/transcript.jsonl`, so co-located
  sessions in one working tree never cross-write logs.
  """

  require Logger

  @spec transcript_path(Path.t(), integer() | String.t()) :: Path.t()
  def transcript_path(workspace, session_id) when is_binary(workspace) do
    Path.join([
      Path.expand(workspace),
      ".symphony",
      "sessions",
      to_string(session_id),
      "transcript.jsonl"
    ])
  end

  @spec append(Path.t(), integer() | String.t(), map() | String.t()) :: :ok
  def append(workspace, session_id, entry) when is_binary(workspace) do
    with {:ok, line} <- encode_line(entry),
         path <- transcript_path(workspace, session_id),
         :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- File.write(path, line <> "\n", [:append]) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("SessionStore.append failed: #{inspect(reason)}")
        :ok

      :error ->
        :ok
    end
  rescue
    error ->
      Logger.warning("SessionStore.append crashed: #{Exception.message(error)}")
      :ok
  end

  @spec exists?(Path.t(), integer() | String.t()) :: boolean()
  def exists?(workspace, session_id) when is_binary(workspace) do
    workspace |> transcript_path(session_id) |> File.regular?()
  end

  defp encode_line(line) when is_binary(line), do: {:ok, String.trim_trailing(line)}
  defp encode_line(%{} = entry), do: Jason.encode(entry)
  defp encode_line(_), do: :error
end
