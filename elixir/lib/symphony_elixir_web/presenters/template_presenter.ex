defmodule SymphonyElixirWeb.TemplatePresenter do
  @moduledoc "JSON DTOs for workspace templates and clone jobs."

  alias SymphonyElixir.LocalTracker.{CloneJob, WorkspaceTemplate, WorkspaceTemplateRepository}

  @spec template(WorkspaceTemplate.t()) :: map()
  def template(%WorkspaceTemplate{} = template) do
    %{
      id: template.id,
      name: template.name,
      slug: template.slug,
      description: template.description,
      validation_commands: WorkspaceTemplate.validation_commands_list(template),
      workflow_statuses: WorkspaceTemplate.workflow_statuses_list(template),
      after_create_hook: template.after_create_hook,
      prompt_template: template.prompt_template,
      dev_env_markdown: template.dev_env_markdown,
      metadata: template.metadata,
      repositories: Enum.map(repositories(template), &repository/1),
      inserted_at: iso8601(template.inserted_at),
      updated_at: iso8601(template.updated_at)
    }
  end

  @spec repository(WorkspaceTemplateRepository.t()) :: map()
  def repository(%WorkspaceTemplateRepository{} = repo) do
    %{
      id: repo.id,
      github_full_name: repo.github_full_name,
      clone_url: repo.clone_url,
      default_branch: repo.default_branch,
      workspace_path: repo.workspace_path,
      role: repo.role
    }
  end

  @spec clone_job(CloneJob.t()) :: map()
  def clone_job(%CloneJob{} = job) do
    %{
      id: job.id,
      repository_id: job.repository_id,
      status: job.status,
      error: job.error,
      commit_sha: job.commit_sha,
      started_at: iso8601(job.started_at),
      completed_at: iso8601(job.completed_at)
    }
  end

  defp repositories(%WorkspaceTemplate{repositories: repos}) when is_list(repos), do: repos
  defp repositories(_), do: []

  defp iso8601(%DateTime{} = dt), do: dt |> DateTime.truncate(:second) |> DateTime.to_iso8601()
  defp iso8601(_), do: nil
end
