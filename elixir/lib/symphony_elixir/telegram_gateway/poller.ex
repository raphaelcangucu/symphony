defmodule SymphonyElixir.TelegramGateway.Poller do
  @moduledoc "Long-polls Telegram Bot API updates and routes them through the gateway router."

  use GenServer

  alias SymphonyElixir.Gateways
  alias SymphonyElixir.Settings.Gateways, as: GatewaySettings
  alias SymphonyElixir.TelegramGateway.Client

  @poll_interval_ms 1_000
  @telegram_timeout_seconds 30

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @impl true
  def init(opts) do
    state = %{
      offset: Keyword.get(opts, :offset, 0),
      interval_ms: Keyword.get(opts, :interval_ms, @poll_interval_ms)
    }

    schedule_poll(0)
    {:ok, state}
  end

  @impl true
  def handle_info(:poll, state) do
    next_state =
      if polling_enabled?() do
        case poll_once(state.offset) do
          {:ok, offset} -> %{state | offset: offset}
          {:error, _reason} -> state
        end
      else
        state
      end

    schedule_poll(next_state.interval_ms)
    {:noreply, next_state}
  end

  @spec poll_once(non_neg_integer(), keyword()) :: {:ok, non_neg_integer()} | {:error, term()}
  def poll_once(offset, opts \\ []) when is_integer(offset) and offset >= 0 and is_list(opts) do
    fetch_updates = Keyword.get(opts, :fetch_updates, &fetch_updates/1)
    route_update = Keyword.get(opts, :route_update, &route_update/1)

    with {:ok, updates} when is_list(updates) <- fetch_updates.(offset) do
      Enum.each(updates, route_update)
      {:ok, next_offset(offset, updates)}
    end
  end

  defp fetch_updates(offset) do
    case Client.call("getUpdates", %{"offset" => offset, "timeout" => @telegram_timeout_seconds}) do
      {:ok, %{"result" => updates}} when is_list(updates) -> {:ok, updates}
      {:ok, _body} -> {:ok, []}
      {:error, reason} -> {:error, reason}
    end
  end

  defp route_update(update) do
    with {:ok, message} <- Gateways.TelegramAdapter.normalize_update(update) do
      Gateways.Router.handle_message(message)
    end
  end

  defp next_offset(offset, []), do: offset

  defp next_offset(offset, updates) do
    updates
    |> Enum.map(&Map.get(&1, "update_id"))
    |> Enum.filter(&is_integer/1)
    |> case do
      [] -> offset
      ids -> Enum.max(ids) + 1
    end
  end

  defp schedule_poll(delay_ms), do: Process.send_after(self(), :poll, delay_ms)

  defp polling_enabled? do
    GatewaySettings.telegram_enabled?() and GatewaySettings.telegram_polling_enabled?()
  rescue
    _ -> false
  end
end
