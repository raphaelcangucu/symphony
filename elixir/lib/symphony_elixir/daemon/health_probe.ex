defmodule SymphonyElixir.Daemon.HealthProbe do
  @moduledoc "Small dependency-free HTTP probe for the local health endpoint."

  @max_response_bytes 1_048_576

  @spec get(String.t(), non_neg_integer(), timeout()) ::
          {:ok, map()} | {:error, term()}
  def get(host, port, timeout \\ 2_000) do
    address = String.to_charlist(host)
    options = [:binary, active: false, packet: :raw]
    deadline = System.monotonic_time(:millisecond) + timeout

    case :gen_tcp.connect(address, port, options, timeout) do
      {:ok, socket} ->
        try do
          with :ok <-
                 :gen_tcp.send(
                   socket,
                   "GET /api/health HTTP/1.1\r\nHost: #{host}\r\nConnection: close\r\n\r\n"
                 ),
               {:ok, response} <- recv_all(socket, [], 0, deadline) do
            parse(response)
          end
        after
          :gen_tcp.close(socket)
        end

      {:error, _reason} = error ->
        error
    end
  end

  @spec parse(String.t()) :: {:ok, map()} | {:error, term()}
  def parse(response) do
    with [head, body] <- String.split(response, "\r\n\r\n", parts: 2),
         [status_line | _] <- String.split(head, "\r\n"),
         {:ok, 200} <- status_code(status_line),
         {:ok, %{} = decoded} <- Jason.decode(body),
         "ok" <- decoded["status"] do
      {:ok, decoded}
    else
      {:ok, code} -> {:error, {:http_status, code}}
      _ -> {:error, :invalid_response}
    end
  end

  defp status_code(status_line) do
    case String.split(status_line, " ", parts: 3) do
      [_, status, _] ->
        case Integer.parse(status) do
          {code, ""} -> {:ok, code}
          _ -> {:error, :invalid_status}
        end

      _ ->
        {:error, :invalid_status}
    end
  end

  defp recv_all(socket, acc, size, deadline) do
    remaining = deadline - System.monotonic_time(:millisecond)

    if remaining <= 0 do
      {:error, :timeout}
    else
      case :gen_tcp.recv(socket, 8_192, remaining) do
        {:ok, bytes} when size + byte_size(bytes) <= @max_response_bytes ->
          recv_all(socket, [bytes | acc], size + byte_size(bytes), deadline)

        {:ok, _bytes} ->
          {:error, :response_too_large}

        {:error, :closed} ->
          {:ok, acc |> Enum.reverse() |> IO.iodata_to_binary()}

        error ->
          error
      end
    end
  end
end
