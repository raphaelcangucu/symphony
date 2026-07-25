defmodule SymphonyElixir.Daemon.HealthProbeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.HealthProbe

  test "parse accepts only a 200 JSON health response" do
    response =
      "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n" <>
        ~s({"status":"ok","version":"0.3.0","git_commit":"abc","mode":"installed"})

    assert {:ok, %{"status" => "ok", "version" => "0.3.0"}} =
             HealthProbe.parse(response)

    assert {:error, {:http_status, 503}} =
             HealthProbe.parse("HTTP/1.1 503 Down\r\n\r\n{}")
  end
end
