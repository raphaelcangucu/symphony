# Send an issue-assigned push notification for the connected operator.
# Usage (from elixir/): set -a && . ./.env && set +a && mix run scripts/push_assign_test.exs [IDENTIFIER] [PROJECT_SLUG]
# Example: mix run scripts/push_assign_test.exs GAM-4 gamba

defmodule Symphony.PushAssignTest do
  alias SymphonyElixir.LocalTracker.{IssueRecord, Project, Viewer}
  alias SymphonyElixir.PushNotifications.{Config, Dispatcher, Subscriptions}
  alias SymphonyElixir.Repo

  import Ecto.Query

  def run([identifier, project_slug | _]) when is_binary(identifier) and is_binary(project_slug) do
    run(identifier, project_slug)
  end

  def run([identifier | _]) when is_binary(identifier), do: run(identifier, "gamba")

  def run(_argv), do: run("GAM-4", "gamba")

  defp run(identifier, project_slug) do
    start_repo!()

    IO.puts("=== Issue assigned push test ===\n")

    unless Config.enabled?() do
      IO.puts("FAIL: VAPID not configured")
      System.halt(1)
    end

    case Viewer.current() do
      {:ok, %{login: login}} ->
        IO.puts("✓ Viewer: #{login}")

      {:error, reason} ->
        IO.puts("FAIL: viewer unavailable: #{inspect(reason)}")
        System.halt(1)
    end

    count = Subscriptions.count()
    IO.puts("✓ Push subscriptions: #{count}")

    if count == 0 do
      IO.puts(
        "\nWARN: no browser subscription saved. Open http://127.0.0.1:4000/tracker/settings in Chrome and click \"Enable notifications\", then rerun."
      )
    end

    case fetch_issue(project_slug, identifier) do
      {:ok, issue} ->
        IO.puts("✓ Issue: #{issue.identifier} — #{issue.title}")
        IO.puts("  assignee_id: #{inspect(issue.assignee_id)}")

        previous = %{assignee_id: nil, assignee_remote_id: nil}
        :ok = Dispatcher.issue_assigned(issue, previous)
        IO.puts("\n✓ Dispatched issue_assigned notification")
        IO.puts("  title: Tarefa associada a você")
        IO.puts("  url: /tracker/projects/#{project_slug}/board/issues/#{identifier}")

      {:error, reason} ->
        IO.puts("FAIL: issue not found: #{inspect(reason)}")
        System.halt(1)
    end
  end

  defp fetch_issue(project_slug, identifier) do
    case Repo.get_by(Project, slug: project_slug) do
      %Project{id: project_id} ->
        issue =
          from(i in IssueRecord,
            where: i.project_id == ^project_id and i.identifier == ^identifier,
            preload: [:project]
          )
          |> Repo.one()

        case issue do
          %IssueRecord{} = record -> {:ok, record}
          nil -> {:error, :not_found}
        end

      nil ->
        {:error, :project_not_found}
    end
  end

  defp start_repo! do
    Application.load(:symphony_elixir)

    for app <- [:logger, :crypto, :ssl, :exqlite, :ecto, :ecto_sql, :db_connection, :nimble_pool, :jose, :req, :phoenix_pubsub] do
      {:ok, _} = Application.ensure_all_started(app)
    end

    public = System.get_env("SYMPHONY_VAPID_PUBLIC_KEY")
    private = System.get_env("SYMPHONY_VAPID_PRIVATE_KEY")
    subject = System.get_env("SYMPHONY_VAPID_SUBJECT") || "mailto:symphony@localhost"

    if public && private do
      Application.put_env(:ex_nudge, :vapid_public_key, public)
      Application.put_env(:ex_nudge, :vapid_private_key, private)
      Application.put_env(:ex_nudge, :vapid_subject, subject)
    end

    db = System.get_env("SYMPHONY_LOCAL_TRACKER_DATABASE")

    if is_binary(db) and db != "" do
      Application.put_env(:symphony_elixir, SymphonyElixir.Repo, database: db)
    end

    {:ok, _} = Repo.start_link()
    {:ok, _} = SymphonyElixir.LocalTracker.Viewer.Server.start_link([])
  end
end

Symphony.PushAssignTest.run(System.argv())
