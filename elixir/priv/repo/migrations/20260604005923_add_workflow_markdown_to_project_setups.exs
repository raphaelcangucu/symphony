defmodule SymphonyElixir.Repo.Migrations.AddWorkflowMarkdownToProjectSetups do
  use Ecto.Migration

  import Ecto.Query

  # Additive + backfill only. The legacy `workflow_config`/`prompt_template`
  # columns are dropped in a later migration once all readers use
  # `workflow_markdown`.
  def up do
    alter table(:local_tracker_project_setups) do
      add :workflow_markdown, :text
    end

    flush()

    rows =
      repo().all(
        from(s in "local_tracker_project_setups",
          select: %{
            id: s.id,
            workflow_config: s.workflow_config,
            prompt_template: s.prompt_template
          }
        )
      )

    Enum.each(rows, fn row ->
      markdown =
        SymphonyElixir.Workflow.to_markdown(
          decode_config(row.workflow_config),
          row.prompt_template || ""
        )

      repo().update_all(
        from(s in "local_tracker_project_setups", where: s.id == ^row.id),
        set: [workflow_markdown: markdown]
      )
    end)
  end

  def down do
    alter table(:local_tracker_project_setups) do
      remove :workflow_markdown
    end
  end

  defp decode_config(nil), do: %{}
  defp decode_config(map) when is_map(map), do: map

  defp decode_config(json) when is_binary(json) do
    case Jason.decode(json) do
      {:ok, map} when is_map(map) -> map
      _ -> %{}
    end
  end

  defp decode_config(_), do: %{}
end
