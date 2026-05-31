defmodule Symphony.Scripts.PublicTunnelScriptTest do
  use ExUnit.Case, async: true

  import Bitwise

  @script Path.expand("../../scripts/public-tunnel.sh", __DIR__)

  test "script exists and is executable" do
    assert File.exists?(@script)
    stat = File.stat!(@script)
    assert (stat.mode &&& 0o100) != 0
  end

  test "script declares the wildcard ingress and runs the named tunnel" do
    contents = File.read!(@script)
    assert contents =~ "hostname: \"*.tracker.cods.dev\""
    assert contents =~ "service: http://127.0.0.1:4000"
    assert contents =~ "cloudflared tunnel"
    refute contents =~ "cloudflared tunnel route dns"
  end
end
