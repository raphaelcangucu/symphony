defmodule SymphonyElixir.Daemon.HealthProbe do
  @moduledoc "Small dependency-free HTTP probe for the local health endpoint."

  @spec get(String.t(), non_neg_integer(), timeout()) ::
          {:ok, map()} | {:error, term()}
  def get(host, port, timeout \\ 2_000) do
    address = String.to_charlist(host)
    options = [:binary, active: false, packet: :raw]

    with {:ok, socket} <- :gen_tcp.connect(address, port, options, timeout),
         :ok <-
           :gen_tcp.send(
             socket,
             "GET /api/health HTTP/1.1\r\nHost: #{host}\r\nConnection: close\r\n\r\n"
           ),
         {:ok, response} <- recv_all(socket, "", timeout) do
      :gen_tcp.close(socket)
      parse(response)
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

  defp recv_all(socket, acc, timeout) do
    case :gen_tcp.recv(socket, 0, timeout) do
      {:ok, bytes} -> recv_all(socket, acc <> bytes, timeout)
      {:error, :closed} -> {:ok, acc}
      error -> error
    end
  end
end
