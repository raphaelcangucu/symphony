defmodule SymphonyElixir.MobileComparison.EventBus do
  @moduledoc false

  @spec subscribe(String.t(), map()) :: :ok | {:error, term()}
  def subscribe(topic, _context) when is_binary(topic) do
    Phoenix.PubSub.subscribe(SymphonyElixir.PubSub, topic)
  end
end
