defmodule SymphonyElixir.AttachedContextsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AttachedContexts
  alias SymphonyElixir.AttachedContexts.Attachment
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.SavedContexts.Entry

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    Repo.delete_all(Attachment)
    Repo.delete_all(Entry)

    {:ok, project} = Context.ensure_project(%{name: "Symphony Tracker", slug: "sym"})
    {:ok, target_issue} = Context.create_issue(project.slug, %{title: "Target task", status: "Todo"})
    {:ok, context_issue} = Context.create_issue(project.slug, %{title: "Context task", status: "Todo"})

    %{project: project, target_issue: target_issue, context_issue: context_issue}
  end

  test "attach upserts by execution scope and context reference", %{project: project, target_issue: target, context_issue: context} do
    scope = AttachedContexts.execution_scope(project.slug, target.identifier)
    attrs = %{kind: "board_issue", ref_key: context.identifier}

    assert {:ok, first} = AttachedContexts.attach(scope, attrs)
    assert {:ok, second} = AttachedContexts.attach(scope, attrs)

    assert first.id == second.id
    assert [attached] = AttachedContexts.list(scope)
    assert attached.ref_key == context.identifier
  end

  test "append_to_instructions includes loaded context before operator text", %{project: project, target_issue: target, context_issue: context} do
    scope = AttachedContexts.execution_scope(project.slug, target.identifier)
    assert {:ok, _attached} = AttachedContexts.attach(scope, %{kind: "board_issue", ref_key: context.identifier})

    injected = AttachedContexts.append_to_instructions(scope, "Do the implementation.")

    assert injected =~ "## Loaded Context"
    assert injected =~ "### Board issue #{context.identifier}"
    assert injected =~ "Do the implementation."
  end

  test "append_to_instructions resolves draft context refs without persisting", %{
    project: project,
    target_issue: target,
    context_issue: context
  } do
    scope = AttachedContexts.execution_scope(project.slug, target.identifier)

    injected =
      AttachedContexts.append_to_instructions(scope, "Use this context.",
        context_refs: [
          %{"type" => "issue", "id" => context.identifier}
        ]
      )

    assert injected =~ "## Loaded Context"
    assert injected =~ "### Board issue #{context.identifier}"
    assert injected =~ "Use this context."
    assert AttachedContexts.list(scope) == []
  end

  test "append_to_instructions accepts ephemeral draft context content", %{project: project, target_issue: target} do
    scope = AttachedContexts.execution_scope(project.slug, target.identifier)

    injected =
      AttachedContexts.append_to_instructions(scope, "Use the agent context.",
        context_refs: [
          %{
            "type" => "file",
            "id" => "tracker/src/App.tsx",
            "label" => "App.tsx",
            "content" => "### Agent file context\n\n- Path: tracker/src/App.tsx"
          }
        ]
      )

    assert injected =~ "## Loaded Context"
    assert injected =~ "### Agent file context"
    assert injected =~ "tracker/src/App.tsx"
    assert injected =~ "Use the agent context."
    assert AttachedContexts.list(scope) == []
  end

  test "hard reset does not clear attachments implicitly", %{project: project, target_issue: target, context_issue: context} do
    scope = AttachedContexts.execution_scope(project.slug, target.identifier)
    assert {:ok, _attached} = AttachedContexts.attach(scope, %{kind: "board_issue", ref_key: context.identifier})

    assert length(AttachedContexts.list(scope)) == 1
  end

  test "assistant scope stores attachments by thread", %{project: project, context_issue: context} do
    scope = AttachedContexts.assistant_scope(project.slug, 42)

    assert {:ok, attached} = AttachedContexts.attach(scope, %{kind: "board_issue", ref_key: context.identifier})

    assert attached.scope == "assistant"
    assert attached.thread_id == 42
    assert [listed] = AttachedContexts.list(scope)
    assert listed.id == attached.id
  end

  test "attach accepts controller-style string keyed params", %{project: project, target_issue: target, context_issue: context} do
    scope = AttachedContexts.execution_scope(project.slug, target.identifier)

    assert {:ok, attached} =
             AttachedContexts.attach(scope, %{
               "kind" => "board_issue",
               "ref_key" => context.identifier,
               "metadata" => %{"source" => "controller"}
             })

    assert attached.kind == "board_issue"
    assert attached.metadata["source"] == "controller"
  end

  test "attach returns invalid param errors instead of raising", %{project: project, target_issue: target} do
    scope = AttachedContexts.execution_scope(project.slug, target.identifier)

    assert {:error, {:invalid_params, :kind}} = AttachedContexts.attach(scope, %{"ref_key" => "SYM-2"})
    assert {:error, {:invalid_params, :ref_key}} = AttachedContexts.attach(scope, %{"kind" => "board_issue"})
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
