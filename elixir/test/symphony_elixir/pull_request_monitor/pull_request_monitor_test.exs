defmodule SymphonyElixir.PullRequestMonitorTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.PullRequestMonitor.MonitorState
  alias SymphonyElixir.PullRequestMonitor
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    :ok
  end

  describe "decide/4" do
    test "verdict table" do
      assert PullRequestMonitor.decide(:merged, nil, 0, 2) == :move_done
      assert PullRequestMonitor.decide(:ci_failure, "pr_caused", 0, 2) == :move_rework
      assert PullRequestMonitor.decide(:ci_failure, "pr_caused", 1, 2) == :move_rework
      assert PullRequestMonitor.decide(:ci_failure, "pr_caused", 2, 2) == {:stay, :limit_reached}
      assert PullRequestMonitor.decide(:ci_failure, "unrelated", 0, 2) == {:stay, :unrelated}
      assert PullRequestMonitor.decide(:ci_failure, "needs_human", 0, 2) == {:stay, :needs_human}
      assert PullRequestMonitor.decide(:review_findings, "fixable_by_agent", 0, 2) == :move_rework
      assert PullRequestMonitor.decide(:review_findings, "fixable_by_agent", 2, 2) == {:stay, :limit_reached}
      assert PullRequestMonitor.decide(:review_findings, "needs_human", 0, 2) == {:stay, :needs_human}
      assert PullRequestMonitor.decide(:review_findings, "unrelated", 0, 2) == {:stay, :needs_human}
    end
  end

  describe "process_issue/3" do
    setup do
      {:ok, project} =
        Context.ensure_project(%{
          name: "Project",
          slug: "proj",
          tracker_kind: "github",
          tracker_config: %{"repo" => "o/r", "project_id" => "PVT_proj"}
        })

      workflow_markdown =
        Workflow.to_markdown(
          %{
            "tracker" => %{"wait_states" => ["Human Review"]},
            "pr_monitor" => %{"enabled" => true, "max_auto_rework" => 2}
          },
          ""
        )

      {:ok, _setup} = Context.upsert_project_setup(project.slug, %{"workflow_markdown" => workflow_markdown})
      {:ok, issue} = Context.create_issue(project.slug, %{title: "Fix this", status: "Human Review"})

      %{project: project, issue: issue}
    end

    test "reconciles detected PRs to DB and workpad", %{project: project, issue: issue} do
      test_pid = self()

      prs = [
        %{
          url: "https://github.com/GambaLabs/backend/pull/3997",
          number: 3997,
          repo: "GambaLabs/backend",
          state: "open",
          head_ref: "symphony/1857",
          title: "x",
          merged: false,
          head_sha: "abc",
          checks_state: nil,
          pipelines: [],
          conversation: []
        }
      ]

      o =
        opts(
          pull_request_reader: fn _p, _i, _o -> {:ok, prs} end,
          workpad_upsert: fn issue_id, body ->
            send(test_pid, {:workpad, issue_id, body})
            :ok
          end
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)

      assert {:ok, [row]} =
               SymphonyElixir.Tracker.Sync.PullRequests.for_issue("proj", issue.identifier)

      assert row.url == "https://github.com/GambaLabs/backend/pull/3997"
      assert row.head_branch == "symphony/1857"

      assert_received {:workpad, _issue_id, body}
      assert body =~ "symphony:prs"
      assert body =~ "https://github.com/GambaLabs/backend/pull/3997"
    end

    test "merged PR moves issue to Done and records action", %{project: project, issue: issue} do
      calls = start_supervised!({Agent, fn -> [] end})

      dispatch = fn _p, fun, args ->
        Agent.update(calls, &[{fun, args} | &1])
        {:ok, %{}}
      end

      assert :ok = PullRequestMonitor.process_issue(project, issue, opts(issue_dispatch: dispatch))

      recorded = Agent.get(calls, &Enum.reverse/1)
      assert [{:add_comment, _}, {:move_issue, [identifier, %{"status" => "Done"}]}] = recorded
      assert identifier == issue.identifier
      assert %{last_action: "moved_to_done"} = MonitorState.get("proj", issue.identifier, "u7")
    end

    test "partial merge keeps issue in wait state until every PR is merged", %{project: project, issue: issue} do
      calls = start_supervised!({Agent, fn -> [] end})

      dispatch = fn _p, fun, args ->
        Agent.update(calls, &[{fun, args} | &1])
        {:ok, %{}}
      end

      prs = [
        merged_pr(),
        %{
          number: 8,
          url: "u8",
          title: "other repo",
          state: "open",
          merged: false,
          author: "bot",
          head_sha: "def",
          checks_state: nil,
          pipelines: [],
          conversation: []
        }
      ]

      o =
        opts(
          pull_request_reader: fn _p, _i, _o -> {:ok, prs} end,
          issue_dispatch: dispatch
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)
      assert Agent.get(calls, & &1) == []
      assert %{last_action: "merged_awaiting_others"} = MonitorState.get("proj", issue.identifier, "u7")

      all_merged =
        Enum.map(prs, fn
          %{url: "u8"} = pr -> Map.merge(pr, %{state: "merged", merged: true})
          pr -> pr
        end)

      assert :ok =
               PullRequestMonitor.process_issue(
                 project,
                 issue,
                 Keyword.merge(o, pull_request_reader: fn _p, _i, _o -> {:ok, all_merged} end)
               )

      assert [{:add_comment, _}, {:move_issue, [identifier, %{"status" => "Done"}]}] =
               Agent.get(calls, &Enum.reverse/1)

      assert identifier == issue.identifier
    end

    test "pr_caused CI failure moves to Rework and increments the counter", %{project: project, issue: issue} do
      calls = start_supervised!({Agent, fn -> [] end})

      dispatch = fn _p, fun, args ->
        Agent.update(calls, &[{fun, args} | &1])
        {:ok, %{}}
      end

      o =
        opts(
          pull_request_reader: fn _p, _i, _o -> {:ok, [failing_pr()]} end,
          classifier: fn :ci_failure, _ctx, _o -> {:ok, %{"verdict" => "pr_caused", "summary" => "broke login"}} end,
          issue_dispatch: dispatch
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)

      assert [{:add_comment, _}, {:move_issue, [identifier, %{"status" => "Rework"}]}] =
               Agent.get(calls, &Enum.reverse/1)

      assert identifier == issue.identifier
      assert %{auto_rework_count: 1, last_action: "moved_to_rework"} = MonitorState.get("proj", issue.identifier, "u7")
    end

    test "review findings can move to Rework and persist marker", %{project: project, issue: issue} do
      marker = "2026-06-10T12:00:00Z"
      calls = start_supervised!({Agent, fn -> [] end})

      dispatch = fn _p, fun, args ->
        Agent.update(calls, &[{fun, args} | &1])
        {:ok, %{}}
      end

      o =
        opts(
          pull_request_reader: fn _p, _i, _o -> {:ok, [review_findings_pr(marker)]} end,
          classifier: fn :review_findings, _ctx, _o ->
            {:ok, %{"verdict" => "fixable_by_agent", "summary" => "s"}}
          end,
          issue_dispatch: dispatch
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)

      assert [{:add_comment, _}, {:move_issue, [identifier, %{"status" => "Rework"}]}] =
               Agent.get(calls, &Enum.reverse/1)

      assert identifier == issue.identifier

      assert %{last_review_marker: ^marker, auto_rework_count: 1, last_action: "moved_to_rework"} =
               MonitorState.get("proj", issue.identifier, "u7")
    end

    test "rework limit keeps issue and records limit_reached", %{project: project, issue: issue} do
      {:ok, _} = MonitorState.upsert("proj", issue.identifier, "u7", %{auto_rework_count: 2})
      calls = start_supervised!({Agent, fn -> [] end})

      dispatch = fn _p, fun, args ->
        Agent.update(calls, &[{fun, args} | &1])
        {:ok, %{}}
      end

      o =
        opts(
          pull_request_reader: fn _p, _i, _o -> {:ok, [failing_pr()]} end,
          classifier: fn _k, _c, _o -> {:ok, %{"verdict" => "pr_caused", "summary" => "s"}} end,
          issue_dispatch: dispatch
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)

      assert [{:add_comment, _}] = Agent.get(calls, &Enum.reverse/1)
      assert %{last_action: "limit_reached"} = MonitorState.get("proj", issue.identifier, "u7")
    end

    test "unrelated failure stays with kept_human_review action", %{project: project, issue: issue} do
      o =
        opts(
          pull_request_reader: fn _p, _i, _o -> {:ok, [failing_pr()]} end,
          classifier: fn _k, _c, _o -> {:ok, %{"verdict" => "unrelated", "summary" => "flaky infra"}} end
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)
      assert %{last_action: "kept_human_review"} = MonitorState.get("proj", issue.identifier, "u7")
    end

    test "same fingerprint is not reprocessed", %{project: project, issue: issue} do
      count = start_supervised!({Agent, fn -> 0 end})

      o =
        opts(
          pull_request_reader: fn _p, _i, _o -> {:ok, [failing_pr()]} end,
          classifier: fn _k, _c, _o ->
            Agent.update(count, &(&1 + 1))
            {:ok, %{"verdict" => "unrelated", "summary" => "s"}}
          end
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)
      assert :ok = PullRequestMonitor.process_issue(project, issue, o)
      assert Agent.get(count, & &1) == 1
    end

    test "issue that left the wait state is not moved", %{project: project, issue: issue} do
      {:ok, _} = Context.move_issue(project.slug, issue.identifier, %{"status" => "Done"})

      calls = start_supervised!({Agent, fn -> [] end})

      dispatch = fn _p, fun, args ->
        Agent.update(calls, &[{fun, args} | &1])
        {:ok, %{}}
      end

      o =
        opts(
          pull_request_reader: fn _p, _i, _o -> {:ok, [failing_pr()]} end,
          classifier: fn _k, _c, _o -> {:ok, %{"verdict" => "pr_caused", "summary" => "s"}} end,
          issue_dispatch: dispatch
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)
      assert Agent.get(calls, & &1) == []
    end

    test "dispatch failure rolls back consumed fingerprint and allows reclassification", %{
      project: project,
      issue: issue
    } do
      count = start_supervised!({Agent, fn -> 0 end})

      o =
        opts(
          pull_request_reader: fn _p, _i, _o -> {:ok, [failing_pr()]} end,
          classifier: fn :ci_failure, _ctx, _o ->
            Agent.update(count, &(&1 + 1))
            {:ok, %{"verdict" => "pr_caused", "summary" => "s"}}
          end,
          issue_dispatch: fn _p, :add_comment, _args -> {:error, :boom} end
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)
      assert %{last_checks_fingerprint: nil} = MonitorState.get("proj", issue.identifier, "u7")

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)
      assert Agent.get(count, & &1) == 2
    end

    test "cross-PR counter ratchets from issue-level max and then reaches limit", %{
      project: project,
      issue: issue
    } do
      {:ok, _} = MonitorState.upsert("proj", issue.identifier, "other-url", %{auto_rework_count: 1})
      calls = start_supervised!({Agent, fn -> [] end})
      pull_reader_calls = :atomics.new(1, [])

      dispatch = fn _p, fun, args ->
        Agent.update(calls, &[{fun, args} | &1])
        {:ok, %{}}
      end

      o =
        opts(
          pull_request_reader: fn _p, _i, _o ->
            idx = :atomics.get(pull_reader_calls, 1)
            :atomics.put(pull_reader_calls, 1, idx + 1)

            pr =
              case idx do
                0 -> failing_pr()
                _ -> failing_pr(%{head_sha: "def"})
              end

            {:ok, [pr]}
          end,
          classifier: fn :ci_failure, _ctx, _o -> {:ok, %{"verdict" => "pr_caused", "summary" => "s"}} end,
          issue_dispatch: dispatch
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)
      assert %{auto_rework_count: 2} = MonitorState.get("proj", issue.identifier, "u7")

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)
      assert %{last_action: "limit_reached"} = MonitorState.get("proj", issue.identifier, "u7")

      assert [
               {:add_comment, _},
               {:move_issue, [_, %{"status" => "Rework"}]},
               {:add_comment, _}
             ] = Agent.get(calls, &Enum.reverse/1)
    end

    test "no-op evaluation persists last_checked_at and last_event without acting", %{
      project: project,
      issue: issue
    } do
      calls = start_supervised!({Agent, fn -> [] end})

      dispatch = fn _p, fun, args ->
        Agent.update(calls, &[{fun, args} | &1])
        {:ok, %{}}
      end

      o =
        opts(
          pull_request_reader: fn _p, _i, _o -> {:ok, [clean_pr()]} end,
          issue_dispatch: dispatch
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)

      assert Agent.get(calls, & &1) == []
      row = MonitorState.get("proj", issue.identifier, "u7")
      assert row.last_event == "none"
      assert row.last_action == nil
      assert %DateTime{} = row.last_checked_at
    end

    test "review marker rolls back when add_comment dispatch fails", %{project: project, issue: issue} do
      marker = "2026-06-11T00:00:00Z"

      o =
        opts(
          pull_request_reader: fn _p, _i, _o -> {:ok, [review_findings_pr(marker)]} end,
          classifier: fn :review_findings, _ctx, _o ->
            {:ok, %{"verdict" => "fixable_by_agent", "summary" => "s"}}
          end,
          issue_dispatch: fn _p, :add_comment, _args -> {:error, :boom} end
        )

      assert :ok = PullRequestMonitor.process_issue(project, issue, o)
      assert %{last_review_marker: nil} = MonitorState.get("proj", issue.identifier, "u7")
    end
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp merged_pr do
    %{
      number: 7,
      url: "u7",
      title: "t",
      state: "merged",
      merged: true,
      author: "bot",
      head_sha: "abc",
      checks_state: nil,
      pipelines: [],
      conversation: []
    }
  end

  defp clean_pr do
    %{
      number: 7,
      url: "u7",
      title: "t",
      state: "open",
      merged: false,
      author: "bot",
      head_sha: "abc",
      checks_state: nil,
      pipelines: [],
      conversation: []
    }
  end

  defp failing_pr(overrides \\ %{}) do
    %{
      number: 7,
      url: "u7",
      title: "t",
      state: "open",
      merged: false,
      author: "bot",
      head_sha: "abc",
      checks_state: "FAILURE",
      pipelines: [
        %{
          name: "CI",
          url: "https://github.com/o/r/actions/runs/99",
          jobs: [%{name: "test", status: "COMPLETED", conclusion: "FAILURE", url: nil, job_id: 1}]
        }
      ],
      conversation: []
    }
    |> Map.merge(overrides)
  end

  defp review_findings_pr(marker) do
    %{
      number: 7,
      url: "u7",
      title: "t",
      state: "open",
      merged: false,
      author: "bot",
      head_sha: "abc",
      checks_state: nil,
      pipelines: [],
      conversation: [
        %{
          author: "review-bot",
          body: "Blocking: missing nil check",
          review_state: "CHANGES_REQUESTED",
          created_at: marker
        }
      ]
    }
  end

  defp opts(overrides) do
    Keyword.merge(
      [
        pull_request_reader: fn _project, _identifier, _opts -> {:ok, [merged_pr()]} end,
        classifier: fn _kind, _context, _opts -> {:ok, %{"verdict" => "needs_human", "summary" => "s"}} end,
        check_logs: fn _repo, _id -> {:ok, "boom"} end,
        changed_files: fn _repo, _number -> ["lib/login.ex"] end,
        issue_dispatch: fn _project, _fun, _args -> {:ok, %{}} end
      ],
      overrides
    )
  end
end
