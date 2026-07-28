defmodule SymphonyElixir.MobileComparison.PresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileComparison.Presenter

  @session %{
    id: "session-codex",
    path: :session,
    provider: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
    effective_effort: "high"
  }

  test "durable passed evidence completes a persistent direct-session thread" do
    cell =
      Presenter.cell(
        @session,
        %{identifier: "DEV-2"},
        %{id: 42, status: "active"},
        nil,
        [],
        [%{"run_id" => "run-1", "status" => "passed"}]
      )

    assert cell["status"] == "passed"
  end

  test "durable failed evidence fails a persistent direct-session thread" do
    cell =
      Presenter.cell(
        @session,
        %{identifier: "DEV-2"},
        %{id: 42, status: "active"},
        nil,
        [],
        [%{"run_id" => "run-1", "status" => "failed"}]
      )

    assert cell["status"] == "failed"
  end

  test "the newest durable snapshot supersedes a partial failure from the same session" do
    cell =
      Presenter.cell(
        @session,
        %{identifier: "DEV-2"},
        %{id: 42, status: "closed"},
        nil,
        [],
        [
          %{
            "run_id" => "run-final",
            "session_id" => "assistant-thread:42",
            "status" => "passed"
          },
          %{
            "run_id" => "run-partial",
            "session_id" => "assistant-thread:42",
            "status" => "failed"
          }
        ]
      )

    assert cell["status"] == "passed"
  end

  test "a persistent direct-session thread remains live until evidence exists" do
    cell =
      Presenter.cell(
        @session,
        %{identifier: "DEV-2"},
        %{id: 42, status: "active"},
        nil,
        [],
        []
      )

    assert cell["status"] == "live"
  end

  test "a retry stays live and increments its attempt while preserving prior evidence" do
    cell =
      Presenter.cell(
        @session,
        %{identifier: "DEV-2"},
        %{
          id: 43,
          status: "active",
          retry_attempt: 1,
          metadata: %{"current_turn" => %{"status" => "running"}}
        },
        nil,
        [],
        [
          %{
            "run_id" => "attempt-1",
            "session_id" => "assistant-thread:42",
            "status" => "failed"
          }
        ]
      )

    assert cell["status"] == "live"
    assert cell["attempt"] == 2

    assert cell["evidence"] == [
             %{
               "run_id" => "attempt-1",
               "session_id" => "assistant-thread:42",
               "status" => "failed"
             }
           ]
  end

  test "passed artifacts do not hide an interrupted direct-session turn" do
    cell =
      Presenter.cell(
        @session,
        %{identifier: "DEV-2"},
        %{
          id: 43,
          status: "error",
          retry_attempt: 1,
          error: "serve_restart"
        },
        nil,
        [],
        [
          %{
            "run_id" => "attempt-1",
            "session_id" => "assistant-thread:42",
            "status" => "failed"
          },
          %{
            "run_id" => "attempt-2",
            "session_id" => "assistant-thread:43",
            "status" => "passed"
          }
        ]
      )

    assert cell["status"] == "error"
    assert cell["attempt"] == 2
    assert cell["error"] == "serve_restart"
  end

  test "a provider turn that completed without assistant output is retryable" do
    cell =
      Presenter.cell(
        @session,
        %{identifier: "DEV-2"},
        %{
          id: 42,
          status: "active",
          latest_message: "Cursor completed the turn without returning assistant text."
        },
        nil,
        [],
        []
      )

    assert cell["status"] == "failed"
  end
end
