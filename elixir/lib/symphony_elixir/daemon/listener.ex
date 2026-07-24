defmodule SymphonyElixir.Daemon.Listener do
  @moduledoc "Finds Linux listener PIDs through `ss` without mutating them."

  @type result :: :free | {:owned, [pos_integer()]} | {:unknown, term()}

  @spec probe(non_neg_integer(), keyword()) :: result()
  def probe(port, opts \\ []) when is_integer(port) and port >= 0 do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    case runner.(
           "ss",
           ["-H", "-ltnp", "sport = :#{port}"],
           stderr_to_stdout: true
         ) do
      {output, 0} -> parse(output)
      {output, status} -> {:unknown, {:ss_failed, status, String.trim(output)}}
    end
  rescue
    error -> {:unknown, error}
  end

  @spec parse(String.t()) :: :free | {:owned, [pos_integer()]}
  def parse(output) when is_binary(output) do
    pids =
      ~r/pid=(\d+)/
      |> Regex.scan(output, capture: :all_but_first)
      |> Enum.map(fn [pid] -> String.to_integer(pid) end)
      |> Enum.uniq()
      |> Enum.sort()

    if String.trim(output) == "", do: :free, else: {:owned, pids}
  end
end
