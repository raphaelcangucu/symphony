defmodule SymphonyElixir.HTTP.ErrorBody do
  @moduledoc """
  Shared helpers for logging HTTP error response bodies without flooding the
  logs. Used by the GitHub, Linear and JIRA clients.
  """

  @max_error_body_log_bytes 1_000

  @doc """
  Renders an error response body as a single-line string capped at
  #{@max_error_body_log_bytes} bytes, suitable for inclusion in log messages.
  """
  @spec summarize(term()) :: String.t()
  def summarize(body) when is_binary(body) do
    body
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> truncate()
    |> inspect()
  end

  def summarize(body) do
    body
    |> inspect(limit: 20, printable_limit: @max_error_body_log_bytes)
    |> truncate()
  end

  @doc "Caps a binary at #{@max_error_body_log_bytes} bytes, marking truncation."
  @spec truncate(binary()) :: binary()
  def truncate(body) when is_binary(body) do
    if byte_size(body) > @max_error_body_log_bytes do
      binary_part(body, 0, @max_error_body_log_bytes) <> "...<truncated>"
    else
      body
    end
  end
end
