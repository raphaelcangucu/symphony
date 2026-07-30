defmodule SymphonyElixir.Orchestrator.RunUpdateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator.RunUpdate

  @timestamp ~U[2026-07-08 12:00:00Z]

  test "accumulates token totals and records the latest event/message" do
    running = %{
      session_id: "s1",
      agent_input_tokens: 5,
      agent_output_tokens: 2,
      agent_total_tokens: 7,
      codex_last_reported_input_tokens: 10,
      codex_last_reported_output_tokens: 4,
      codex_last_reported_total_tokens: 14,
      turn_count: 1,
      agent_kind: "codex",
      goal: nil
    }

    update = %{
      event: :agent_message,
      timestamp: @timestamp,
      usage: %{input_tokens: 30, output_tokens: 10, total_tokens: 40},
      payload: %{"method" => "notification"}
    }

    {entry, delta} = RunUpdate.integrate(running, update)

    assert delta.input_tokens == 20
    assert entry.agent_input_tokens == 25
    assert entry.agent_total_tokens == 33
    assert entry.codex_last_reported_total_tokens == 40
    assert entry.last_codex_event == :agent_message
    assert entry.last_codex_timestamp == @timestamp
    assert entry.last_codex_message.event == :agent_message
    assert entry.session_id == "s1"
    assert entry.turn_count == 1
  end

  test "increments the turn count when a new session starts" do
    running = %{session_id: "s1", turn_count: 2}
    update = %{event: :session_started, timestamp: @timestamp, session_id: "s2"}

    {entry, _delta} = RunUpdate.integrate(running, update)

    assert entry.session_id == "s2"
    assert entry.turn_count == 3
  end

  test "uses a provider conversation id as the canonical runtime session id" do
    running = %{session_id: nil, turn_count: 0}

    {entry, _delta} =
      RunUpdate.integrate(running, %{
        event: :session_started,
        timestamp: @timestamp,
        provider: "codex",
        conversation_id: "codex-native-thread-11"
      })

    assert entry.session_id == "codex-native-thread-11"
    assert entry.turn_count == 1
  end

  test "increments the turn count when the same native conversation starts another turn" do
    running = %{session_id: "s1", turn_count: 2}
    update = %{event: :session_started, timestamp: @timestamp, session_id: "s1"}

    {entry, _delta} = RunUpdate.integrate(running, update)

    assert entry.turn_count == 3
  end

  test "clears the goal on a thread/goal/cleared payload" do
    running = %{session_id: "s1", goal: %{objective: "x"}, agent_kind: "codex"}
    update = %{event: :notification, timestamp: @timestamp, payload: %{"method" => "thread/goal/cleared"}}

    {entry, _delta} = RunUpdate.integrate(running, update)

    assert entry.goal == nil
  end

  test "stringifies an integer app-server pid from the update" do
    running = %{session_id: "s1"}
    update = %{event: :notification, timestamp: @timestamp, codex_app_server_pid: 4321}

    {entry, _delta} = RunUpdate.integrate(running, update)

    assert entry.codex_app_server_pid == "4321"
  end
end
