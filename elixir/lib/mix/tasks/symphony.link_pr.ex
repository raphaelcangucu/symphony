defmodule Mix.Tasks.Symphony.LinkPr do
  use Mix.Task

  alias SymphonyElixir.GitHub.PullRequestUrl
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.Sync.LocalStore

  @shortdoc "Manually links a GitHub PR url to a tracker issue"
  @moduledoc """
  Usage:

      mix symphony.link_pr <project_slug> <issue_identifier> <pr_url>

  Example:

      mix symphony.link_pr clouapp-front "#510" https://github.com/clouapp/back/pull/277
  """

  @impl Mix.Task
  def run([project_slug, identifier, url]) do
    Mix.Task.run("app.start")

    with {:ok, parsed} <- PullRequestUrl.parse(url),
         {:ok, issue} <- Context.get_issue(project_slug, identifier),
         {:ok, pr} <-
           LocalStore.link_manual_pull_request(issue, %{
             url: url,
             repo: parsed.repo,
             number: parsed.number
           }) do
      Mix.shell().info("Linked #{pr.repo}##{pr.number} to #{project_slug}/#{identifier}")
    else
      {:error, reason} -> Mix.raise("Could not link PR: #{inspect(reason)}")
    end
  end

  def run(_args) do
    Mix.raise("Usage: mix symphony.link_pr <project_slug> <issue_identifier> <pr_url>")
  end
end
