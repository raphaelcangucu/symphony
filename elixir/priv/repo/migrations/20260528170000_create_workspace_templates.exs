defmodule SymphonyElixir.Repo.Migrations.CreateWorkspaceTemplates do
  use Ecto.Migration

  def change do
    create table(:local_tracker_workspace_templates) do
      add(:name, :string, null: false)
      add(:slug, :string, null: false)
      add(:description, :string)
      add(:workflow_statuses, :map, null: false, default: %{})
      add(:validation_commands, :map, null: false, default: %{})
      add(:after_create_hook, :text)
      add(:before_run_hook, :text)
      add(:after_run_hook, :text)
      add(:before_remove_hook, :text)
      add(:prompt_template, :text)
      add(:dev_env_markdown, :text)
      add(:metadata, :map, null: false, default: %{})
      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:local_tracker_workspace_templates, [:slug]))

    create table(:local_tracker_workspace_template_repositories) do
      add(
        :template_id,
        references(:local_tracker_workspace_templates, on_delete: :delete_all),
        null: false
      )

      add(:github_full_name, :string, null: false)
      add(:clone_url, :string, null: false)
      add(:default_branch, :string)
      add(:workspace_path, :string, null: false)
      add(:role, :string)
      timestamps(type: :utc_datetime_usec)
    end

    create(index(:local_tracker_workspace_template_repositories, [:template_id]))

    create table(:local_tracker_clone_jobs) do
      add(:project_id, references(:local_tracker_projects, on_delete: :delete_all), null: false)
      add(:repository_id, references(:local_tracker_repositories, on_delete: :delete_all), null: false)
      add(:status, :string, null: false, default: "pending")
      add(:error, :text)
      add(:started_at, :utc_datetime_usec)
      add(:completed_at, :utc_datetime_usec)
      add(:commit_sha, :string)
      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:local_tracker_clone_jobs, [:project_id, :repository_id]))
  end
end
