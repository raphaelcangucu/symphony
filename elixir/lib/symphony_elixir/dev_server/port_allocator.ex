defmodule SymphonyElixir.DevServer.PortAllocator do
  @moduledoc """
  Picks a free TCP port from a `[min, max]` range, skipping ports already
  claimed by live instances. A candidate is "free" when `:gen_tcp.listen/2`
  succeeds; the probe socket is closed immediately and the port handed back.
  """

  @spec allocate([pos_integer()], [pos_integer()]) :: {:ok, pos_integer()} | {:error, :no_free_port}
  def allocate([min, max], claimed)
      when is_integer(min) and is_integer(max) and min <= max and is_list(claimed) do
    claimed_set = MapSet.new(claimed)

    min..max//1
    |> Enum.reject(&MapSet.member?(claimed_set, &1))
    |> Enum.find_value({:error, :no_free_port}, fn port ->
      if bindable?(port), do: {:ok, port}, else: false
    end)
  end

  def allocate(_range, _claimed), do: {:error, :no_free_port}

  defp bindable?(port) do
    case :gen_tcp.listen(port, [:binary, ip: {127, 0, 0, 1}, reuseaddr: true]) do
      {:ok, socket} ->
        :gen_tcp.close(socket)
        true

      {:error, _reason} ->
        false
    end
  end
end
