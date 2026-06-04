defmodule SymphonyElixir.Repo.Migrations.DropLegacyWorkflowColumnsFromProjectSetups do
  use Ecto.Migration

  # Per-project behavior is now stored solely in `workflow_markdown` (backfilled
  # by 20260604005923). Drop the legacy `workflow_config`/`prompt_template`
  # columns; no deprecation window.
  def up do
    alter table(:local_tracker_project_setups) do
      remove :workflow_config
      remove :prompt_template
    end
  end

  def down do
    alter table(:local_tracker_project_setups) do
      add :workflow_config, :map, default: %{}
      add :prompt_template, :text
    end
  end
end
