defmodule SymphonyElixirWeb.PresenterTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixirWeb.Presenter

  defp running_entry(issue_id, identifier, project_slug) do
    %{
      pid: self(),
      ref: make_ref(),
      identifier: identifier,
      issue: %Issue{
        id: issue_id,
        identifier: identifier,
        title: "Title #{identifier}",
        description: "",
        state: "In Progress",
        url: "https://example.org/issues/#{identifier}",
        project_slug: project_slug
      },
      session_id: "thread-#{issue_id}",
      codex_app_server_pid: nil,
      turn_count: 1,
      last_codex_message: nil,
      last_codex_timestamp: nil,
      last_codex_event: nil,
      agent_input_tokens: 0,
      agent_output_tokens: 0,
      agent_total_tokens: 0,
      codex_last_reported_input_tokens: 0,
      codex_last_reported_output_tokens: 0,
      codex_last_reported_total_tokens: 0,
      started_at: DateTime.utc_now()
    }
  end

  defp retry_entry(identifier, project_slug) do
    %{
      attempt: 1,
      timer_ref: nil,
      due_at_ms: System.monotonic_time(:millisecond) + 5_000,
      identifier: identifier,
      error: "boom",
      project_slug: project_slug
    }
  end

  defp start_orchestrator_with(running, retry_attempts) do
    orchestrator_name = Module.concat(__MODULE__, :"Orchestrator#{System.unique_integer([:positive])}")
    {:ok, pid} = Orchestrator.start_link(name: orchestrator_name)

    on_exit(fn ->
      if Process.alive?(pid), do: Process.exit(pid, :normal)
    end)

    :sys.replace_state(pid, fn state ->
      claimed =
        running
        |> Map.keys()
        |> Enum.reduce(state.claimed, &MapSet.put(&2, &1))

      %{state | running: running, retry_attempts: retry_attempts, claimed: claimed}
    end)

    orchestrator_name
  end

  test "state_payload/2 includes project_slug on running and retrying entries" do
    running = %{
      "issue-a" => running_entry("issue-a", "MT-1", "alpha")
    }

    retry_attempts = %{
      "issue-b" => retry_entry("MT-2", "beta")
    }

    orchestrator = start_orchestrator_with(running, retry_attempts)

    payload = Presenter.state_payload(orchestrator, 1_000)

    assert [%{project_slug: "alpha"}] = payload.running
    assert [%{project_slug: "beta"}] = payload.retrying
  end

  test "state_payload/3 scopes running/retrying to the given project_slug" do
    running = %{
      "issue-a1" => running_entry("issue-a1", "MT-10", "alpha"),
      "issue-a2" => running_entry("issue-a2", "MT-11", "alpha"),
      "issue-b1" => running_entry("issue-b1", "MT-20", "beta")
    }

    retry_attempts = %{
      "issue-ar" => retry_entry("MT-12", "alpha"),
      "issue-br" => retry_entry("MT-21", "beta")
    }

    orchestrator = start_orchestrator_with(running, retry_attempts)

    payload = Presenter.state_payload(orchestrator, 1_000, "alpha")

    assert Enum.all?(payload.running, &(&1.project_slug == "alpha"))
    assert Enum.all?(payload.retrying, &(&1.project_slug == "alpha"))
    assert payload.counts.running == Enum.count(payload.running)
    assert payload.counts.retrying == Enum.count(payload.retrying)
    assert payload.counts.running == 2
    assert payload.counts.retrying == 1
  end

  test "state_payload/3 with nil project_slug equals state_payload/2" do
    running = %{
      "issue-a" => running_entry("issue-a", "MT-1", "alpha"),
      "issue-b" => running_entry("issue-b", "MT-2", "beta")
    }

    retry_attempts = %{
      "issue-c" => retry_entry("MT-3", "alpha")
    }

    orchestrator = start_orchestrator_with(running, retry_attempts)

    nil_payload = Presenter.state_payload(orchestrator, 1_000, nil)
    base_payload = Presenter.state_payload(orchestrator, 1_000)

    assert nil_payload.counts == base_payload.counts

    assert Enum.map(nil_payload.running, & &1.issue_id) ==
             Enum.map(base_payload.running, & &1.issue_id)

    assert Enum.map(nil_payload.retrying, & &1.issue_id) ==
             Enum.map(base_payload.retrying, & &1.issue_id)
  end
end
