defmodule SymphonyElixir.HotpathCache.Owner do
  @moduledoc """
  Long-lived owner for the `SymphonyElixir.HotpathCache` ETS tables.

  ETS tables are deleted when their creating process exits. Without a stable
  owner the cache (and its single-flight lock table) would be owned by whichever
  short-lived request/task process created it first and vanish when that process
  died. Owning the tables from a supervised process keeps them alive for the
  daemon's lifetime so single-flight coordination is reliable.
  """

  use GenServer

  alias SymphonyElixir.HotpathCache

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, :ok, name: Keyword.get(opts, :name, __MODULE__))
  end

  @impl true
  def init(:ok) do
    HotpathCache.ensure_tables!()
    {:ok, %{}}
  end
end
