defmodule SymphonyElixirWeb.SubagentObservabilityTest do
  @moduledoc """
  End-to-end proof that gated subagent units of an in-flight coordinator parent
  surface in the observability sessions feed as `waiting` rows nested under the
  parent — no agent, no tokens — while the dependency-free unit runs live.
  """
  use ExUnit.Case, async: false

  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Orchestrator
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings
  alias SymphonyElixirWeb.Presenter

  setup do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    {:ok, true} = Settings.put("lab", "bundle_child_orchestration", true)
    on_exit(fn -> Settings.put("lab", "bundle_child_orchestration", false) end)
    :ok
  end

  defp running_entry(issue_id, identifier, extra) do
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
        url: "https://example.org/#{identifier}",
        project_slug: "macro-markets"
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
      started_at: DateTime.utc_now(),
      bundle_role: :standalone,
      parent_identifier: nil,
      unit_id: nil,
      repo: nil,
      child_identifiers: []
    }
    |> Map.merge(Map.new(extra))
  end

  defp start_orchestrator(running) do
    name = Module.concat(__MODULE__, :"Orch#{System.unique_integer([:positive])}")
    {:ok, pid} = Orchestrator.start_link(name: name)
    on_exit(fn -> if Process.alive?(pid), do: Process.exit(pid, :normal) end)

    :sys.replace_state(pid, fn state ->
      claimed = running |> Map.keys() |> Enum.reduce(state.claimed, &MapSet.put(&2, &1))
      %{state | running: running, claimed: claimed}
    end)

    name
  end

  defp seed_coordinator_bundle! do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, _parent} = Context.create_issue("macro-markets", %{title: "Coordinator", status: "In Progress"})
    {:ok, _api} = Context.create_issue("macro-markets", %{title: "API", status: "In Progress"})
    {:ok, _ui} = Context.create_issue("macro-markets", %{title: "UI", status: "In Progress"})
    {:ok, _docs} = Context.create_issue("macro-markets", %{title: "Docs", status: "In Progress"})
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-2", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-3", "MAC-1")
    {:ok, _} = Context.set_issue_parent("macro-markets", "MAC-4", "MAC-1")

    workpad = """
    ## Codex Workpad

    ### Execution bundle

    ```yaml
    version: 1
    mode: bundle
    parent: MAC-1
    units:
      - id: api
        type: subagent_unit
        issue: MAC-2
        repo: macro/be
        produces: [schema]
      - id: ui
        type: subagent_unit
        issue: MAC-3
        repo: macro/fe
        consumes: [schema]
        depends_on: [api]
      - id: docs
        type: subagent_unit
        issue: MAC-4
        repo: macro/fe
        depends_on: [ui]
    shared_contracts:
      - id: schema
        owner_unit: api
        consumers: [ui]
        status: draft
    ```
    """

    {:ok, _} = Context.add_comment("macro-markets", "MAC-1", workpad, %{kind: "workpad"})
    :ok
  end

  test "gated subagent units surface as waiting rows under the coordinator while the dep-free unit runs live" do
    seed_coordinator_bundle!()

    running = %{
      "id-MAC-1" => running_entry("id-MAC-1", "MAC-1", %{}),
      "id-MAC-2" =>
        running_entry("id-MAC-2", "MAC-2", %{
          bundle_role: :child,
          parent_identifier: "MAC-1",
          unit_id: "MAC-2",
          repo: "macro/be"
        })
    }

    orchestrator = start_orchestrator(running)
    payload = Presenter.state_payload(orchestrator, 2_000, "macro-markets")

    by_identifier = Map.new(payload.running, &{&1.issue_identifier, &1})

    # The coordinator and the dependency-free unit run live.
    assert by_identifier["MAC-1"].status == "live"
    assert by_identifier["MAC-2"].status == "live"
    assert by_identifier["MAC-2"].bundle_role == "child"

    # The gated siblings are parked as waiting subagents nested under the parent.
    assert mac3 = by_identifier["MAC-3"]
    assert mac3.status == "waiting"
    assert mac3.bundle_role == "subagent"
    assert mac3.parent_identifier == "MAC-1"
    assert mac3.unit_id == "ui"
    assert mac3.repo == "macro/fe"
    assert mac3.tokens == %{input_tokens: 0, output_tokens: 0, total_tokens: 0}
    assert mac3.session_id == nil
    assert is_binary(mac3.last_message)

    assert mac4 = by_identifier["MAC-4"]
    assert mac4.status == "waiting"
    assert mac4.bundle_role == "subagent"
    assert mac4.parent_identifier == "MAC-1"

    # Waiting subagents are not counted as active workers.
    assert payload.counts.running == 2
  end
end
