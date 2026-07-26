defmodule SymphonyElixir.MobileRpc.Methods.OrchestratorTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileRpc.Methods.Orchestrator

  defmodule FakeService do
    def list_executions do
      [
        %{
          "execution_session_id" => 77,
          "issue_identifier" => "DEV-10",
          "status" => "live",
          "agent_kind" => "codex"
        }
      ]
    end

    def session_context(77), do: {:ok, %{project_slug: "dev10x"}}
    def session_context(_id), do: {:error, :not_found}
  end

  defmodule FakeBridge do
    def subscribe_channel(connection_pid, key, subscription_id, opts) do
      pid = spawn(fn -> loop(connection_pid) end)
      send(connection_pid, {:subscribed, key, subscription_id, opts, pid})
      {:ok, pid}
    end

    def lookup_channel(connection_pid, key) do
      send(connection_pid, {:looked_up, key})
      {:ok, connection_pid}
    end

    def activate(pid), do: send(pid, :activate)

    def command(pid, event, payload) do
      send(pid, {:bridge_command, event, payload})
      :ok
    end

    defp loop(parent) do
      receive do
        :activate ->
          send(parent, :bridge_activated)
          loop(parent)

        :stop ->
          :ok
      end
    end
  end

  defp context do
    %{
      connection_pid: self(),
      orchestrator_mobile_service: FakeService,
      session_bridge: FakeBridge,
      agent_execution_channel: __MODULE__.FakeExecutionChannel,
      session_log_channel: __MODULE__.FakeLogChannel
    }
  end

  test "lists execution sessions with their agent and live status" do
    assert {:ok, %{"executions" => [%{"execution_session_id" => 77}]}} =
             Orchestrator.ExecutionsList.call(%{}, context())

    assert {:error, :invalid_params} = Orchestrator.ExecutionsList.validate(%{"extra" => true})
  end

  test "subscribes to the host execution stream" do
    assert {:ok, {:subscription, subscription_id, _, _cleanup, activate}} =
             Orchestrator.ExecutionsSubscribe.call(%{}, context())

    assert_receive {:subscribed, {:orchestrator_executions, :all}, ^subscription_id, opts, bridge}
    assert opts[:topic] == "agent_executions"
    assert opts[:event_prefix] == "orchestrator.executions"

    activate.()
    assert_receive :bridge_activated
    send(bridge, :stop)
  end

  test "subscribes to a real issue_execution transcript and accepts steer" do
    params = %{"execution_session_id" => 77}

    assert {:ok, {:subscription, subscription_id, _, _cleanup, activate}} =
             Orchestrator.SessionSubscribe.call(params, context())

    assert_receive {:subscribed, {:orchestrator_session, 77}, ^subscription_id, opts, bridge}
    assert opts[:topic] == "session_log:77"
    assert opts[:join_payload] == %{"project_slug" => "dev10x"}
    assert opts[:event_prefix] == "orchestrator.session"
    assert opts[:emit_joined] == true

    activate.()
    assert_receive :bridge_activated
    send(bridge, :stop)

    assert {:ok, %{"accepted" => true}} =
             Orchestrator.SessionCommand.call(
               %{
                 "execution_session_id" => 77,
                 "event" => "steer",
                 "payload" => %{"message" => "Focus on the RPC"}
               },
               context()
             )

    assert_receive {:looked_up, {:orchestrator_session, 77}}
    assert_receive {:bridge_command, "steer_turn", %{"message" => "Focus on the RPC"}}
  end

  test "rejects commands outside the bounded steer contract" do
    assert {:error, :invalid_params} =
             Orchestrator.SessionCommand.validate(%{
               "execution_session_id" => 77,
               "event" => "shell",
               "payload" => %{"message" => "rm"}
             })
  end
end
