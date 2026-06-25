defmodule SymphonyElixir.Cloudflare.TunnelTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Cloudflare.Tunnel

  setup do
    Application.put_env(:symphony_elixir, :cloudflare_tunnel_checker, fn -> false end)

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :cloudflare_tunnel_checker)
      Application.delete_env(:symphony_elixir, :cloudflare_tunnel_spawner)
    end)

    :ok
  end

  test "status/0 is :disabled when the server is not running" do
    assert Tunnel.status() == :disabled
    assert Tunnel.summary() == %{enabled: false, running: false}
  end

  test "start_tunnel/0 spawns the tunnel script when the server is not running" do
    put_spawner(spawner_recording_to(self(), :ok))

    assert Tunnel.start_tunnel() == {:ok, :running}
    assert_received {:tunnel_spawn, %{script: script, log: log}}
    assert String.ends_with?(script, "scripts/public-tunnel.sh")
    assert log == "/tmp/symphony-cloudflared.log"
  end

  test "status reflects the liveness checker when the server is running" do
    put_checker(fn -> true end)
    start_supervised!(Tunnel)

    assert Tunnel.status() == :running
    assert Tunnel.summary() == %{enabled: true, running: true}

    put_checker(fn -> false end)
    assert Tunnel.status() == :stopped
    assert Tunnel.summary() == %{enabled: true, running: false}
  end

  test "start_tunnel is a no-op when already running" do
    put_checker(fn -> true end)
    put_spawner(spawner_recording_to(self()))
    start_supervised!(Tunnel)

    assert Tunnel.start_tunnel() == {:ok, :running}
    refute_received {:tunnel_spawn, _spec}
  end

  test "start_tunnel spawns the script when stopped and reports running" do
    put_checker(fn -> false end)
    put_spawner(spawner_recording_to(self(), :ok))
    start_supervised!(Tunnel)

    assert Tunnel.start_tunnel() == {:ok, :running}
    assert_received {:tunnel_spawn, %{script: script, log: log}}
    assert String.ends_with?(script, "scripts/public-tunnel.sh")
    assert log == "/tmp/symphony-cloudflared.log"
  end

  test "start_tunnel surfaces spawn errors" do
    put_checker(fn -> false end)
    put_spawner(fn _spec -> {:error, :boom} end)
    start_supervised!(Tunnel)

    assert Tunnel.start_tunnel() == {:error, :boom}
  end

  test "summary_for_project reflects project workflow and live tunnel status" do
    refute Tunnel.summary_for_project("missing-project").enabled

    put_checker(fn -> true end)
    start_supervised!(Tunnel)

    assert Tunnel.summary_for_project("missing-project") == %{enabled: false, running: true}
  end

  defp put_checker(fun), do: Application.put_env(:symphony_elixir, :cloudflare_tunnel_checker, fun)
  defp put_spawner(fun), do: Application.put_env(:symphony_elixir, :cloudflare_tunnel_spawner, fun)

  defp spawner_recording_to(pid, result \\ :ok) do
    fn spec ->
      send(pid, {:tunnel_spawn, spec})
      result
    end
  end
end
