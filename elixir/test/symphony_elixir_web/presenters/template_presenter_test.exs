defmodule SymphonyElixirWeb.TemplatePresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.{CloneJob, WorkspaceTemplate, WorkspaceTemplateRepository}
  alias SymphonyElixirWeb.TemplatePresenter

  test "template/1 serializes lists and repositories" do
    template = %WorkspaceTemplate{
      id: 1,
      name: "Gamba",
      slug: "gamba",
      description: nil,
      validation_commands: %{"items" => ["mix test"]},
      workflow_statuses: %{"items" => [%{"name" => "Todo"}]},
      after_create_hook: "echo hi",
      prompt_template: nil,
      dev_env_markdown: nil,
      metadata: %{},
      repositories: [%WorkspaceTemplateRepository{id: 2, github_full_name: "g/api", clone_url: "u", workspace_path: "api", role: "backend", default_branch: "main"}]
    }

    json = TemplatePresenter.template(template)
    assert json.slug == "gamba"
    assert json.validation_commands == ["mix test"]
    assert [%{github_full_name: "g/api"}] = json.repositories
  end

  test "template/1 falls back to empty repositories when not loaded" do
    template = %WorkspaceTemplate{
      id: 1,
      name: "Gamba",
      slug: "gamba",
      description: nil,
      validation_commands: %{"items" => []},
      workflow_statuses: %{"items" => []},
      after_create_hook: nil,
      prompt_template: nil,
      dev_env_markdown: nil,
      metadata: %{},
      repositories: %Ecto.Association.NotLoaded{
        __field__: :repositories,
        __owner__: WorkspaceTemplate,
        __cardinality__: :many
      }
    }

    json = TemplatePresenter.template(template)
    assert json.repositories == []
  end

  test "clone_job/1 serializes job with ISO8601 timestamps" do
    started = ~U[2026-05-28 12:00:00.500000Z]
    completed = ~U[2026-05-28 12:05:30.750000Z]

    job = %CloneJob{
      id: 7,
      repository_id: 3,
      status: "succeeded",
      error: nil,
      commit_sha: "abc123",
      started_at: started,
      completed_at: completed
    }

    json = TemplatePresenter.clone_job(job)

    assert json == %{
             id: 7,
             repository_id: 3,
             status: "succeeded",
             error: nil,
             commit_sha: "abc123",
             started_at: "2026-05-28T12:00:00Z",
             completed_at: "2026-05-28T12:05:30Z"
           }
  end
end
