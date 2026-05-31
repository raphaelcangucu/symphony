defmodule SymphonyElixir.Recents do
  @moduledoc "Builds a unified, time-ranked list of recent assistant chats and Codex/issue runs."

  alias SymphonyElixir.{AgentExecution, LocalTracker.Context}
  alias SymphonyElixir.Assistant.History

  @type kind :: :chat | :codex
  @type item :: map()

  @default_limit 20

  @spec list(keyword()) :: [item()]
  def list(opts \\ []) when is_list(opts) do
    limit = Keyword.get(opts, :limit, @default_limit)
    executions = Keyword.get_lazy(opts, :executions, &safe_executions/0)
    projects = Keyword.get_lazy(opts, :projects, &safe_projects/0)
    issue_lister = Keyword.get(opts, :issue_lister, &default_issue_lister/1)

    repair_lingering_issue_drafts()

    (chat_items(limit) ++ codex_items(projects, issue_lister, executions))
    |> Enum.sort_by(& &1.updated_at, {:desc, DateTime})
    |> Enum.take(limit)
  end

  defp chat_items(limit) do
    [limit: limit]
    |> History.list_threads()
    |> Enum.map(fn thread ->
      preview = thread.id |> History.latest_message() |> preview_text()

      %{
        kind: :chat,
        scope: scope_atom(thread.scope),
        id: "chat:#{thread.id}",
        project_slug: thread.project_slug,
        project_name: project_name(thread.project_slug),
        title: chat_title(thread, preview),
        identifier: thread.issue_identifier,
        thread_id: thread.id,
        status: humanize_thread_status(thread.status),
        status_kind: thread_status_kind(thread.status),
        preview: preview,
        updated_at: thread.updated_at
      }
    end)
  end

  defp codex_items(projects, issue_lister, executions) do
    by_identifier = Map.new(executions, &{&1.issue_identifier, &1})

    Enum.flat_map(projects, fn project ->
      slug = project_slug(project)

      issue_lister
      |> safe_list_issues(slug)
      |> Enum.filter(&codex_candidate?(&1, by_identifier))
      |> Enum.map(&codex_item(&1, project, Map.get(by_identifier, &1.identifier)))
    end)
  end

  defp codex_candidate?(issue, by_identifier) do
    Map.has_key?(by_identifier, issue.identifier) or present?(Map.get(issue, :branch_name))
  end

  defp codex_item(issue, project, nil) do
    issue
    |> base_codex_item(project)
    |> Map.merge(%{status: to_string(issue.status || ""), status_kind: workflow_status_kind(issue.status)})
  end

  defp codex_item(issue, project, exec) do
    issue
    |> base_codex_item(project)
    |> Map.merge(%{
      status: humanize_exec_status(exec.status),
      status_kind: exec_status_kind(exec.status),
      updated_at: exec.last_event_at || issue.updated_at
    })
  end

  defp base_codex_item(issue, project) do
    %{
      kind: :codex,
      scope: nil,
      id: "codex:#{issue.identifier}",
      project_slug: project_slug(project),
      project_name: project_name_of(project),
      title: issue.title,
      identifier: issue.identifier,
      thread_id: nil,
      preview: nil,
      updated_at: issue.updated_at
    }
  end

  defp repair_lingering_issue_drafts do
    History.repair_lingering_issue_drafts()
  rescue
    _ -> :ok
  catch
    _, _ -> :ok
  end

  defp safe_executions do
    AgentExecution.list()
  rescue
    _ -> []
  catch
    _, _ -> []
  end

  defp safe_projects do
    Context.list_projects()
  rescue
    _ -> []
  catch
    _, _ -> []
  end

  defp safe_list_issues(issue_lister, slug) do
    issue_lister.(slug)
  rescue
    _ -> []
  catch
    _, _ -> []
  end

  defp default_issue_lister(slug) do
    slug
    |> Context.list_issues([])
    |> Enum.map(fn issue ->
      %{
        identifier: issue.identifier,
        title: issue.title,
        status: issue_status_name(issue),
        branch_name: Map.get(issue, :branch_name),
        updated_at: issue.updated_at
      }
    end)
  end

  defp issue_status_name(%{status: %{name: name}}), do: name
  defp issue_status_name(_), do: nil

  defp project_slug(%{slug: slug}), do: slug
  defp project_slug(%{"slug" => slug}), do: slug

  defp project_name_of(%{name: name}), do: name
  defp project_name_of(%{"name" => name}), do: name
  defp project_name_of(_), do: nil

  defp project_name(nil), do: nil

  defp project_name(slug) when is_binary(slug) do
    case Context.get_project(slug) do
      {:ok, project} -> project.name
      _ -> slug
    end
  end

  defp chat_title(%{title: title}, _preview) when is_binary(title) and title != "", do: title

  defp chat_title(_thread, preview) when is_binary(preview) and preview != "",
    do: String.slice(preview, 0, 80)

  defp chat_title(%{project_slug: slug}, _preview) when is_binary(slug), do: slug
  defp chat_title(_thread, _preview), do: "Freeform chat"

  defp preview_text(nil), do: nil
  defp preview_text(%{content: content}), do: content
  defp preview_text(_), do: nil

  defp scope_atom("project"), do: :project
  defp scope_atom("freeform"), do: :freeform
  defp scope_atom("issue"), do: :issue
  defp scope_atom(_), do: :project

  defp humanize_thread_status("active"), do: "Active"
  defp humanize_thread_status("closed"), do: "Closed"
  defp humanize_thread_status("error"), do: "Error"
  defp humanize_thread_status(other), do: to_string(other)

  defp thread_status_kind("active"), do: :active
  defp thread_status_kind("closed"), do: :closed
  defp thread_status_kind("error"), do: :error
  defp thread_status_kind(_), do: :active

  defp humanize_exec_status(status), do: status |> to_string() |> String.capitalize()

  defp exec_status_kind(:live), do: :running
  defp exec_status_kind(:retrying), do: :running
  defp exec_status_kind(:waiting), do: :waiting
  defp exec_status_kind(:idle), do: :idle
  defp exec_status_kind(_), do: :running

  defp workflow_status_kind(name) when is_binary(name) do
    down = String.downcase(name)

    cond do
      String.contains?(down, ["done", "complete", "merged", "closed"]) -> :done
      String.contains?(down, "review") -> :in_progress
      String.contains?(down, ["progress", "doing", "started"]) -> :in_progress
      String.contains?(down, ["todo", "backlog", "triage"]) -> :todo
      true -> :active
    end
  end

  defp workflow_status_kind(_name), do: :active

  defp present?(value) when is_binary(value), do: String.trim(value) != ""
  defp present?(_value), do: false
end
