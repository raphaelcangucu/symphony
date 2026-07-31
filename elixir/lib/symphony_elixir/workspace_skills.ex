defmodule SymphonyElixir.WorkspaceSkills do
  @moduledoc """
  Prepares per-workspace skill links for agent CLIs and browser editor chats.

  Codex and Claude Code discover skills from flat `skills/<name>/SKILL.md`
  trees. Symphony keeps obra/superpowers under `skills/superpowers/<name>`,
  so each workspace gets a generated flat mirror and agent-specific pointers
  to that mirror.
  """

  alias SymphonyElixir.Skills

  @agent_dirs [".codex", ".claude"]
  @editor_root_names ["front", "repo", "back", "docs"]
  @skill_file "SKILL.md"
  @superpowers_dir "superpowers"
  # Authoring-only superpowers skills — omitted from execution workspaces so Codex
  # does not auto-discover and enter design-first loops at session start.
  @authoring_only_skills ~w(brainstorming using-superpowers writing-plans writing-skills)

  @type error ::
          {:workspace_missing, Path.t()}
          | {:skills_root_missing, Path.t()}
          | {:blocked_path, Path.t()}
          | {:file_error, Path.t(), File.posix()}

  @spec prepare(Path.t()) :: :ok | {:error, error()}
  def prepare(workspace) when is_binary(workspace) do
    with :ok <- ensure_existing_directory(workspace, {:workspace_missing, workspace}),
         {:ok, skill_sources} <- skill_sources(),
         :ok <- prepare_mirror(workspace, skill_sources),
         :ok <- prepare_agent_roots(workspace) do
      prune_authoring_skills(workspace)
    end
  end

  def prepare(workspace), do: {:error, {:workspace_missing, inspect(workspace)}}

  defp skill_sources do
    root = Skills.root()

    with :ok <- ensure_existing_directory(root, {:skills_root_missing, root}) do
      {:ok,
       root
       |> top_level_skill_sources()
       |> Kernel.++(superpower_skill_sources(root))
       |> Enum.sort_by(fn {name, _path} -> name end)}
    end
  end

  defp top_level_skill_sources(root) do
    root
    |> child_skill_sources()
    |> Enum.reject(fn {name, _path} -> name == @superpowers_dir end)
  end

  defp superpower_skill_sources(root) do
    root
    |> Path.join(@superpowers_dir)
    |> child_skill_sources()
    |> Enum.reject(fn {name, _path} -> name in @authoring_only_skills end)
  end

  defp child_skill_sources(root) do
    case File.ls(root) do
      {:ok, entries} ->
        entries
        |> Enum.map(fn name -> {name, Path.join(root, name)} end)
        |> Enum.filter(fn {_name, path} -> File.regular?(Path.join(path, @skill_file)) end)

      {:error, _reason} ->
        []
    end
  end

  defp prepare_mirror(workspace, skill_sources) do
    mirror = mirror_root(workspace)

    case ensure_directory(mirror) do
      :ok -> ensure_skill_links(mirror, skill_sources)
      {:error, reason} -> {:error, reason}
    end
  end

  defp ensure_skill_links(mirror, skill_sources) do
    Enum.reduce_while(skill_sources, :ok, fn {name, source_path}, :ok ->
      mirror
      |> Path.join(name)
      |> ensure_symlink(source_path)
      |> continue_or_halt()
    end)
  end

  defp prepare_agent_roots(workspace) do
    with {:ok, roots} <- agent_roots(workspace) do
      Enum.reduce_while(roots, :ok, fn root, :ok ->
        root
        |> prepare_agent_root(mirror_root(workspace))
        |> continue_or_halt()
      end)
    end
  end

  # Editor roots are looked up by lstat (not File.dir?/1) so a symlinked
  # editor root is rejected outright instead of silently traversed: following
  # it would let workspace preparation write agent scaffolding through the
  # link into whatever it points at.
  defp agent_roots(workspace) do
    case collect_nested_roots(@editor_root_names, workspace, []) do
      {:ok, nested_roots} -> {:ok, [workspace | nested_roots]}
      {:error, reason} -> {:error, reason}
    end
  end

  defp collect_nested_roots([], _workspace, acc), do: {:ok, Enum.reverse(acc)}

  defp collect_nested_roots([name | rest], workspace, acc) do
    path = Path.join(workspace, name)

    case File.lstat(path) do
      {:ok, %File.Stat{type: :directory}} -> collect_nested_roots(rest, workspace, [path | acc])
      {:ok, %File.Stat{type: :symlink}} -> {:error, {:blocked_path, path}}
      {:ok, _stat} -> collect_nested_roots(rest, workspace, acc)
      {:error, :enoent} -> collect_nested_roots(rest, workspace, acc)
      {:error, reason} -> {:error, {:file_error, path, reason}}
    end
  end

  defp prepare_agent_root(root, mirror) do
    case ensure_agent_links(root, mirror) do
      :ok -> maybe_append_git_excludes(root)
      {:error, reason} -> {:error, reason}
    end
  end

  defp ensure_agent_links(root, mirror) do
    Enum.reduce_while(@agent_dirs, :ok, fn agent_dir, :ok ->
      dir = Path.join(root, agent_dir)
      skills_link = Path.join(dir, "skills")

      with :ok <- ensure_directory(dir),
           :ok <- ensure_skills_path(skills_link, mirror) do
        {:cont, :ok}
      else
        {:error, reason} -> continue_or_halt({:error, reason})
      end
    end)
  end

  # Dispatches to the workspace-internal (relative) linking path used for
  # everything that points at the in-workspace mirror, as opposed to
  # `ensure_symlink/2` below, which links mirror entries to their external
  # skill sources and is intentionally left absolute.
  defp ensure_skills_path(path, mirror) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :directory}} -> populate_existing_skills_directory(path, mirror)
      _other -> ensure_workspace_relative_link(path, mirror)
    end
  end

  defp populate_existing_skills_directory(path, mirror) do
    case File.ls(mirror) do
      {:ok, entries} -> link_skill_entries(path, mirror, entries)
      {:error, reason} -> {:error, {:file_error, mirror, reason}}
    end
  end

  defp link_skill_entries(path, mirror, entries) do
    Enum.reduce_while(entries, :ok, fn entry, :ok ->
      path
      |> Path.join(entry)
      |> ensure_workspace_relative_link(Path.join(mirror, entry))
      |> continue_or_halt()
    end)
  end

  # Creates (or normalizes) a link to a target inside the same workspace tree
  # as a *relative* symlink, so it survives the atomic staging-to-final
  # rename intact instead of resolving through a now-vanished staging path.
  # A link whose current target does not resolve to `target` is left
  # untouched: it was pointed elsewhere on purpose (a custom skill/mirror
  # override) and preparation must not clobber it.
  defp ensure_workspace_relative_link(path, target) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :symlink}} -> ensure_relative_symlink_target(path, target)
      {:ok, _stat} -> {:error, {:blocked_path, path}}
      {:error, :enoent} -> create_relative_symlink(path, target)
      {:error, reason} -> {:error, {:file_error, path, reason}}
    end
  end

  defp ensure_relative_symlink_target(path, target) do
    case File.read_link(path) do
      {:ok, existing_target} -> ensure_relative_form(path, existing_target, target)
      {:error, reason} -> {:error, {:file_error, path, reason}}
    end
  end

  defp ensure_relative_form(path, existing_target, target) do
    cond do
      not same_target?(path, existing_target, target) -> :ok
      Path.type(existing_target) == :relative -> :ok
      true -> replace_symlink(path, relative_target(path, target))
    end
  end

  defp create_relative_symlink(path, target) do
    path
    |> relative_target(target)
    |> File.ln_s(path)
    |> normalize_file_result(path)
  end

  defp relative_target(path, target) do
    Path.relative_to(target, Path.dirname(path), force: true)
  end

  # Agent scratch dirs (`/.codex/`, `/.claude/`) and Symphony's generated
  # evidence tree (`/.symphony/evidence/`) must never be committed into a repo.
  # We scope the evidence exclude to the `evidence/` subdir on purpose: some
  # repos legitimately track their own `.symphony/` tooling (setup/serve/db
  # scripts), so excluding all of `/.symphony/` would drop real project files.
  @git_exclude_entries ["/.codex/", "/.claude/", "/.symphony/evidence/"]

  defp maybe_append_git_excludes(root) do
    info_dir = Path.join([root, ".git", "info"])

    case File.lstat(info_dir) do
      {:ok, %File.Stat{type: :directory}} -> append_git_excludes(info_dir)
      {:ok, %File.Stat{type: :symlink}} -> {:error, {:blocked_path, info_dir}}
      {:ok, _stat} -> :ok
      {:error, :enoent} -> :ok
      {:error, reason} -> {:error, {:file_error, info_dir, reason}}
    end
  end

  defp append_git_excludes(info_dir) do
    exclude_file = Path.join(info_dir, "exclude")

    Enum.reduce_while(@git_exclude_entries, :ok, fn entry, :ok ->
      exclude_file
      |> ensure_exclude_entry(entry)
      |> continue_or_halt()
    end)
  end

  defp ensure_exclude_entry(file, entry) do
    current =
      case File.read(file) do
        {:ok, body} -> body
        {:error, :enoent} -> ""
        {:error, reason} -> return_file_error(file, reason)
      end

    with body when is_binary(body) <- current do
      entries = body |> String.split("\n") |> MapSet.new()

      if MapSet.member?(entries, entry) do
        :ok
      else
        File.mkdir_p!(Path.dirname(file))

        File.write(file, append_line(body, entry))
        |> normalize_file_result(file)
      end
    end
  end

  defp append_line("", entry), do: entry <> "\n"

  defp append_line(body, entry) do
    separator = if String.ends_with?(body, "\n"), do: "", else: "\n"
    body <> separator <> entry <> "\n"
  end

  defp ensure_existing_directory(path, error) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :directory}} -> :ok
      {:ok, _stat} -> {:error, {:blocked_path, path}}
      {:error, :enoent} -> {:error, error}
      {:error, reason} -> {:error, {:file_error, path, reason}}
    end
  end

  defp ensure_directory(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :directory}} ->
        :ok

      {:ok, _stat} ->
        {:error, {:blocked_path, path}}

      {:error, :enoent} ->
        path
        |> File.mkdir_p()
        |> normalize_file_result(path)

      {:error, reason} ->
        {:error, {:file_error, path, reason}}
    end
  end

  defp ensure_symlink(path, target) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :symlink}} ->
        ensure_existing_symlink_target(path, target)

      {:ok, _stat} ->
        {:error, {:blocked_path, path}}

      {:error, :enoent} ->
        target
        |> File.ln_s(path)
        |> normalize_file_result(path)

      {:error, reason} ->
        {:error, {:file_error, path, reason}}
    end
  end

  defp ensure_existing_symlink_target(path, target) do
    case File.read_link(path) do
      {:ok, existing_target} ->
        if same_target?(path, existing_target, target) do
          :ok
        else
          replace_symlink(path, target)
        end

      {:error, reason} ->
        {:error, {:file_error, path, reason}}
    end
  end

  defp replace_symlink(path, target) do
    with :ok <- normalize_file_result(File.rm(path), path),
         :ok <- normalize_file_result(File.ln_s(target, path), path) do
      :ok
    end
  end

  defp same_target?(path, existing_target, target) do
    resolved_existing_target = Path.expand(existing_target, Path.dirname(path))
    resolved_target = Path.expand(target)

    resolved_existing_target == resolved_target or
      same_filesystem_entry?(resolved_existing_target, resolved_target)
  end

  defp same_filesystem_entry?(left, right) do
    case {File.stat(left), File.stat(right)} do
      {{:ok, left_stat}, {:ok, right_stat}} ->
        {left_stat.major_device, left_stat.minor_device, left_stat.inode} ==
          {right_stat.major_device, right_stat.minor_device, right_stat.inode}

      _other ->
        false
    end
  end

  defp mirror_root(workspace), do: Path.join([workspace, ".symphony", "skills"])

  defp prune_authoring_skills(workspace) do
    workspace
    |> prune_skill_directories()
    |> Enum.uniq()
    |> Enum.reduce_while(:ok, fn skills_dir, :ok ->
      prune_authoring_entries(skills_dir)
      |> continue_or_halt()
    end)
  end

  defp prune_skill_directories(workspace) do
    case agent_roots(workspace) do
      {:ok, roots} ->
        agent_skill_dirs =
          Enum.flat_map(roots, fn root -> Enum.map(@agent_dirs, &Path.join([root, &1, "skills"])) end)

        [mirror_root(workspace) | agent_skill_dirs]

      {:error, _reason} ->
        [mirror_root(workspace)]
    end
  end

  defp prune_authoring_entries(skills_dir) do
    case File.lstat(skills_dir) do
      {:ok, %File.Stat{type: :directory}} ->
        Enum.reduce_while(@authoring_only_skills, :ok, fn name, :ok ->
          skills_dir
          |> Path.join(name)
          |> remove_if_present()
          |> continue_or_halt()
        end)

      _other ->
        :ok
    end
  end

  # Only a symlink is ever a managed pointer we created; a real directory at
  # an authoring-only skill name is a user's own custom skill and must survive
  # pruning untouched.
  defp remove_if_present(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :symlink}} -> remove_symlink(path)
      {:ok, _stat} -> :ok
      {:error, :enoent} -> :ok
      {:error, reason} -> {:error, {:file_error, path, reason}}
    end
  end

  defp remove_symlink(path) do
    case File.rm_rf(path) do
      {:ok, _files} -> :ok
      {:error, reason, failed} -> {:error, {:file_error, failed, reason}}
    end
  end

  defp continue_or_halt(:ok), do: {:cont, :ok}
  defp continue_or_halt({:error, reason}), do: {:halt, {:error, reason}}

  defp normalize_file_result(:ok, _path), do: :ok
  defp normalize_file_result({:error, reason}, path), do: {:error, {:file_error, path, reason}}

  defp return_file_error(file, reason), do: {:error, {:file_error, file, reason}}
end
