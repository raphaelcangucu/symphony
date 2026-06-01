defmodule SymphonyElixir.ConfigSyncFlagTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Config

  setup do
    original = Application.get_env(:symphony_elixir, :tracker)
    on_exit(fn -> restore(:tracker, original) end)
    :ok
  end

  defp restore(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore(key, value), do: Application.put_env(:symphony_elixir, key, value)

  test "defaults to false" do
    Application.delete_env(:symphony_elixir, :tracker)
    refute Config.tracker_sync_enabled?()
  end

  test "reads true from the :tracker config (keyword)" do
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)
    assert Config.tracker_sync_enabled?()
  end

  test "reads true from the :tracker config (map)" do
    Application.put_env(:symphony_elixir, :tracker, %{sync_enabled: true})
    assert Config.tracker_sync_enabled?()
  end
end
