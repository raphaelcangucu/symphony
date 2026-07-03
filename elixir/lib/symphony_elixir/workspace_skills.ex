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
    workspace
    |> agent_roots()
    |> Enum.reduce_while(:ok, fn root, :ok ->
      root
      |> prepare_agent_root(mirror_root(workspace))
      |> continue_or_halt()
    end)
  end

  defp agent_roots(workspace) do
    nested_roots =
      @editor_root_names
      |> Enum.map(&Path.join(workspace, &1))
      |> Enum.filter(&File.dir?/1)

    [workspace | nested_roots]
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

  defp ensure_skills_path(path, mirror) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :directory}} -> populate_existing_skills_directory(path, mirror)
      _other -> ensure_symlink(path, mirror)
    end
  end

  defp populate_existing_skills_directory(path, mirror) do
    case File.ls(mirror) do
      {:ok, entries} -> link_missing_skill_entries(path, mirror, entries)
      {:error, reason} -> {:error, {:file_error, mirror, reason}}
    end
  end

  defp link_missing_skill_entries(path, mirror, entries) do
    Enum.reduce_while(entries, :ok, fn entry, :ok ->
      destination = Path.join(path, entry)

      if File.exists?(destination) do
        {:cont, :ok}
      else
        mirror
        |> Path.join(entry)
        |> File.ln_s(destination)
        |> normalize_file_result(destination)
        |> continue_or_halt()
      end
    end)
  end

  # Agent scratch dirs (`/.codex/`, `/.claude/`) and Symphony's generated
  # evidence tree (`/.symphony/evidence/`) must never be committed into a repo.
  # We scope the evidence exclude to the `evidence/` subdir on purpose: some
  # repos legitimately track their own `.symphony/` tooling (setup/serve/db
  # scripts), so excluding all of `/.symphony/` would drop real project files.
  @git_exclude_entries ["/.codex/", "/.claude/", "/.symphony/evidence/"]

  defp maybe_append_git_excludes(root) do
    info_dir = Path.join([root, ".git", "info"])

    if File.dir?(info_dir) do
      exclude_file = Path.join(info_dir, "exclude")

      Enum.reduce_while(@git_exclude_entries, :ok, fn entry, :ok ->
        exclude_file
        |> ensure_exclude_entry(entry)
        |> continue_or_halt()
      end)
    else
      :ok
    end
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
    existing_target
    |> Path.expand(Path.dirname(path))
    |> Kernel.==(Path.expand(target))
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
    agent_skill_dirs =
      workspace
      |> agent_roots()
      |> Enum.flat_map(fn root ->
        Enum.map(@agent_dirs, &Path.join([root, &1, "skills"]))
      end)

    [mirror_root(workspace) | agent_skill_dirs]
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

  defp remove_if_present(path) do
    case File.lstat(path) do
      {:ok, _stat} ->
        case File.rm_rf(path) do
          {:ok, _files} -> :ok
          {:error, reason, failed} -> {:error, {:file_error, failed, reason}}
        end

      {:error, :enoent} ->
        :ok

      {:error, reason} ->
        {:error, {:file_error, path, reason}}
    end
  end

  defp continue_or_halt(:ok), do: {:cont, :ok}
  defp continue_or_halt({:error, reason}), do: {:halt, {:error, reason}}

  defp normalize_file_result(:ok, _path), do: :ok
  defp normalize_file_result({:error, reason}, path), do: {:error, {:file_error, path, reason}}

  defp return_file_error(file, reason), do: {:error, {:file_error, file, reason}}
end
