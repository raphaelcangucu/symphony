defmodule SymphonyElixir.MobileComparison.SessionStarterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileComparison.SessionStarter

  defmodule FakeBridge do
    def start_link(opts), do: Agent.start_link(fn -> opts end)

    def command(pid, event, payload) do
      opts = Agent.get(pid, & &1)
      send(Keyword.fetch!(opts, :connection_pid), {:bridge_command, event, payload})
      :ok
    end
  end

  test "starts the first turn with the persisted provider model and effort" do
    thread = %{
      "id" => 42,
      "agent_kind" => "claude",
      "requested_model" => "claude-opus-5",
      "requested_effort" => "high"
    }

    context = %{
      connection_pid: self(),
      comparison_request_key: "mobile-comparison-1",
      comparison_session_bridge: FakeBridge
    }

    assert :ok = SessionStarter.start(thread, "Build it", context)

    assert_receive {:bridge_command, "send_message",
                    %{
                      "message" => "Build it",
                      "client_message_id" => "mobile-comparison-1:42:initial",
                      "context" => %{
                        "agent" => "claude",
                        "model" => "claude-opus-5",
                        "effort" => "high"
                      }
                    }}
  end
end
