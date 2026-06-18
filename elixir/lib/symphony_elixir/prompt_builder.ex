defmodule SymphonyElixir.PromptBuilder do
  @moduledoc """
  Builds agent prompts from issue data.
  """

  alias SymphonyElixir.{ProjectConfig, Repo}
  alias SymphonyElixir.DevServer
  alias SymphonyElixir.LocalTracker.Context

  @render_opts [strict_filters: true]
  @artifact_max_bytes 512_000
  @max_artifacts 20
  @max_artifact_section_bytes 1_000_000
  @artifact_separator "\n\n"
  @artifact_too_large_message "_Skipped: artifact too large._"
  @artifact_unreadable_message "_Skipped: artifact could not be read._"

  @spec build_prompt(SymphonyElixir.Issue.t(), keyword()) :: String.t()
  def build_prompt(issue, opts \\ []) do
    template =
      issue
      |> resolve_template()
      |> parse_template!()

    rendered =
      template
      |> Solid.render!(
        %{
          "attempt" => Keyword.get(opts, :attempt),
          "issue" => issue |> Map.from_struct() |> to_solid_map()
        },
        @render_opts
      )
      |> IO.iodata_to_binary()
      |> ensure_utf8()

    rendered <>
      workflow_guidance_section(issue, Keyword.get(opts, :agent_kind)) <>
      preview_context_section(issue) <>
      discussion_section(issue) <>
      artifacts_section(Keyword.get(opts, :workspace))
  end

  # Codex receives the long-running objective as a native goal (set on the
  # thread by the orchestrator), so it is not duplicated here. Claude and Cursor
  # have no native goal primitive, so the workflow objective is injected into the
  # prompt and they rely on the agent runner's multi-turn loop for continuation.
  defp workflow_guidance_section(%SymphonyElixir.Issue{agent_goal: goal}, agent_kind)
       when agent_kind in ["claude", "cursor"] and is_binary(goal) do
    case String.trim(goal) do
      "" ->
        ""

      trimmed ->
        """

        ## Long-running workflow

        Treat this issue as a long-running workflow: keep iterating across turns until the objective below is met or you are genuinely blocked. Do not end the run while the issue is still active and work remains.

        #{trimmed}
        """
    end
  end

  defp workflow_guidance_section(_issue, _agent_kind), do: ""

  @doc false
  @spec preview_context_section(SymphonyElixir.Issue.t()) :: String.t()
  def preview_context_section(%SymphonyElixir.Issue{project_slug: slug, identifier: id})
      when is_binary(slug) and slug != "" and is_binary(id) and id != "" do
    case DevServer.issue_targets(slug, id) do
      {:ok, view} ->
        format_preview_context(slug, id, view)

      {:error, _reason} ->
        ""
    end
  end

  def preview_context_section(_issue), do: ""

  defp format_preview_context(project_slug, identifier, view) when is_map(view) do
    available = Map.get(view, :available, false)
    reason = Map.get(view, :reason)
    servers = Map.get(view, :servers, [])

    server_lines =
      servers
      |> Enum.map(&preview_server_line/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n")

    availability =
      if available do
        "Preview is **available** for this issue."
      else
        "Preview is **not available**#{if reason, do: " (#{reason})", else: ""}."
      end

    """
    ## Issue preview (Symphony)

    #{availability}

    Use the **`manage_preview`** tool (`action`: `status` | `start` | `restart`) before UI e2e evidence.
    Do **not** run bare `npx playwright test` on random ports — use the project's configured
    e2e command (see the `evidence` config / project workflow), which reuses the preview ports
    below and the project's isolated e2e database.

    #{if server_lines == "", do: "_No preview servers registered yet — call `manage_preview` with `start`._", else: server_lines}

    Project: `#{project_slug}` · Issue: `#{identifier}`
    """
  end

  defp preview_server_line(server) when is_map(server) do
    slug = Map.get(server, :slug) || Map.get(server, "slug") || "?"
    status = Map.get(server, :status) || Map.get(server, "status") || "unknown"
    port = Map.get(server, :port) || Map.get(server, "port")
    primary = Map.get(server, :primary) || Map.get(server, "primary")
    local_url = local_preview_url(server)

    primary_tag = if primary, do: " (primary UI)", else: ""

    "- `#{slug}`#{primary_tag}: status=#{status}, port=#{inspect(port)}, local=#{local_url}"
  end

  defp preview_server_line(_), do: ""

  defp local_preview_url(server) when is_map(server) do
    port = Map.get(server, :port) || Map.get(server, "port")
    slug = to_string(Map.get(server, :slug) || Map.get(server, "slug") || "")

    cond do
      not is_integer(port) or port <= 0 ->
        "n/a"

      String.contains?(slug, "admin") ->
        "http://127.0.0.1:#{port}/"

      true ->
        "http://127.0.0.1:#{port}/api/health"
    end
  end

  defp local_preview_url(_), do: "n/a"

  defp resolve_template(%SymphonyElixir.Issue{project_slug: slug}) when is_binary(slug) and slug != "" do
    case Context.get_project(slug) do
      {:ok, project} ->
        project
        |> Repo.preload(:setup)
        |> ProjectConfig.resolve_runnable()
        |> case do
          {:ok, %ProjectConfig{prompt_template: prompt}} when is_binary(prompt) ->
            prompt

          {:skip, reason} ->
            raise RuntimeError, "prompt_unresolved: project=#{slug} reason=#{reason}"
        end

      {:error, reason} ->
        raise RuntimeError, "prompt_unresolved: project=#{slug} reason=#{inspect(reason)}"
    end
  end

  defp resolve_template(%SymphonyElixir.Issue{} = issue) do
    raise RuntimeError, "prompt_unresolved: issue=#{inspect(issue.id)} reason=no project_slug"
  end

  defp parse_template!(prompt) when is_binary(prompt) do
    Solid.parse!(prompt)
  rescue
    error ->
      reraise %RuntimeError{
                message: "template_parse_error: #{Exception.message(error)} template=#{inspect(prompt)}"
              },
              __STACKTRACE__
  end

  defp to_solid_map(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {to_string(key), to_solid_value(value)} end)
  end

  defp to_solid_value(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp to_solid_value(%NaiveDateTime{} = value), do: NaiveDateTime.to_iso8601(value)
  defp to_solid_value(%Date{} = value), do: Date.to_iso8601(value)
  defp to_solid_value(%Time{} = value), do: Time.to_iso8601(value)
  defp to_solid_value(%_{} = value), do: value |> Map.from_struct() |> to_solid_map()
  defp to_solid_value(value) when is_map(value), do: to_solid_map(value)
  defp to_solid_value(value) when is_list(value), do: Enum.map(value, &to_solid_value/1)
  defp to_solid_value(value), do: value

  defp ensure_utf8(binary) when is_binary(binary) do
    if String.valid?(binary) do
      binary
    else
      # Replace invalid bytes so Jason.encode! won't crash
      binary
      |> :unicode.characters_to_binary(:latin1, :utf8)
      |> case do
        result when is_binary(result) -> result
        _ -> String.replace(binary, ~r/[^\x00-\x7F]/, "\uFFFD")
      end
    end
  end

  defp discussion_section(%SymphonyElixir.Issue{comments: comments}) when is_list(comments) and comments != [] do
    body =
      comments
      |> Enum.map(&discussion_comment/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n\n")

    if body == "" do
      ""
    else
      """

      ## Recent discussion (issue + PR)

      Symphony injected the latest comments below. On **Rework**, treat human feedback here as required input before coding.

      #{body}
      """
    end
  end

  defp discussion_section(_issue), do: ""

  defp discussion_comment(%{author: author, body: body, created_at: created_at, source: source})
       when is_binary(body) and body != "" do
    header =
      [author, source, format_comment_timestamp(created_at)]
      |> Enum.reject(&(is_nil(&1) or &1 == ""))
      |> Enum.join(" — ")

    if header == "" do
      body
    else
      "---\n**#{header}**\n\n#{body}"
    end
  end

  defp discussion_comment(%{body: body}) when is_binary(body) and body != "", do: body
  defp discussion_comment(_comment), do: ""

  defp format_comment_timestamp(%DateTime{} = datetime), do: DateTime.to_iso8601(datetime)
  defp format_comment_timestamp(%NaiveDateTime{} = datetime), do: NaiveDateTime.to_iso8601(datetime)

  defp format_comment_timestamp(value) when is_binary(value) and value != "", do: value
  defp format_comment_timestamp(_value), do: nil

  defp artifacts_section(workspace) when is_binary(workspace) do
    base = Path.join(workspace, "docs/superpowers")

    if File.dir?(base) do
      files =
        ["specs", "plans"]
        |> Enum.flat_map(fn dir -> base |> Path.join(dir) |> list_markdown_files() end)
        |> Kernel.++(handoff_file(base))

      case files do
        [] ->
          ""

        list ->
          {rendered_artifacts, skipped_count} = render_artifacts(workspace, list)

          "\n\n## Existing authoring artifacts (follow these)\n\n" <>
            (rendered_artifacts
             |> append_artifact_budget_marker(skipped_count)
             |> Enum.join(@artifact_separator))
      end
    else
      ""
    end
  end

  defp artifacts_section(_workspace), do: ""

  defp list_markdown_files(directory) do
    case File.ls(directory) do
      {:ok, entries} ->
        entries
        |> Enum.sort()
        |> Enum.map(&Path.join(directory, &1))
        |> Enum.filter(&regular_markdown_file?/1)

      {:error, _reason} ->
        []
    end
  end

  defp handoff_file(base) do
    file = Path.join(base, "handoff.md")

    if regular_markdown_file?(file) do
      [file]
    else
      []
    end
  end

  defp regular_markdown_file?(path) do
    Path.extname(path) == ".md" and
      match?({:ok, %File.Stat{type: :regular}}, File.lstat(path))
  end

  defp render_artifacts(workspace, files) do
    file_count = length(files)

    result =
      files
      |> Enum.with_index()
      |> Enum.reduce_while({[], 0, 0, 0}, fn {file, index}, {artifacts, artifact_count, bytes_used, _skipped_count} ->
        if artifact_count >= @max_artifacts do
          {:halt, {artifacts, artifact_count, bytes_used, file_count - index}}
        else
          case render_artifact(workspace, file, bytes_used, artifacts == []) do
            {:ok, rendered_artifact, updated_bytes} ->
              {:cont, {[rendered_artifact | artifacts], artifact_count + 1, updated_bytes, 0}}

            :budget_exceeded ->
              {:halt, {artifacts, artifact_count, bytes_used, file_count - index}}
          end
        end
      end)

    {artifacts, _artifact_count, _bytes_used, skipped_count} = result
    {Enum.reverse(artifacts), skipped_count}
  end

  defp render_artifact(workspace, file, bytes_used, first_artifact?) do
    relative_path = Path.relative_to(file, workspace)
    prefix = "### `#{relative_path}`\n\n"
    separator_bytes = if first_artifact?, do: 0, else: byte_size(@artifact_separator)
    remaining_bytes = @max_artifact_section_bytes - bytes_used - separator_bytes

    if remaining_bytes <= 0 do
      :budget_exceeded
    else
      do_render_artifact(file, prefix, bytes_used + separator_bytes, remaining_bytes)
    end
  end

  defp do_render_artifact(file, prefix, updated_bytes_used, remaining_bytes) do
    case File.stat(file) do
      {:ok, %File.Stat{size: size}} when size > @artifact_max_bytes ->
        render_artifact_body(prefix, @artifact_too_large_message, updated_bytes_used, remaining_bytes)

      {:ok, %File.Stat{size: size}} ->
        if byte_size(prefix) + size > remaining_bytes do
          :budget_exceeded
        else
          case File.read(file) do
            {:ok, body} ->
              body = ensure_utf8(body)
              render_artifact_body(prefix, body, updated_bytes_used, remaining_bytes)

            {:error, _reason} ->
              render_artifact_body(prefix, @artifact_unreadable_message, updated_bytes_used, remaining_bytes)
          end
        end

      {:error, _reason} ->
        render_artifact_body(prefix, @artifact_unreadable_message, updated_bytes_used, remaining_bytes)
    end
  end

  defp render_artifact_body(prefix, body, updated_bytes_used, remaining_bytes) do
    rendered_artifact = prefix <> body
    artifact_bytes = byte_size(rendered_artifact)

    if artifact_bytes <= remaining_bytes do
      {:ok, rendered_artifact, updated_bytes_used + artifact_bytes}
    else
      :budget_exceeded
    end
  end

  defp append_artifact_budget_marker(artifacts, 0), do: artifacts

  defp append_artifact_budget_marker(artifacts, skipped_count) do
    artifacts ++ ["_Skipped #{skipped_count} additional authoring artifact(s) due to prompt size limits._"]
  end
end
