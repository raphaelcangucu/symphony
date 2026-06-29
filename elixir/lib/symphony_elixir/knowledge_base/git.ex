defmodule SymphonyElixir.KnowledgeBase.Git do
  @moduledoc """
  Thin `git` CLI wrapper for knowledge base writes, mirroring the codebase's
  `System.cmd("git", args, cd: path, stderr_to_stdout: true)` convention. The
  command runner is injectable for tests via the `:runner` option.
  """

  @type runner ::
          (String.t(), [String.t()], keyword() -> {Collectable.t(), non_neg_integer()})

  @spec run(Path.t(), [String.t()], keyword()) ::
          {:ok, String.t()} | {:error, {non_neg_integer(), String.t()}}
  def run(dir, args, opts \\ []) do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    case runner.("git", args, cd: dir, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim(output)}
      {output, status} -> {:error, {status, String.trim(to_string(output))}}
    end
  end

  @spec current_branch(Path.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def current_branch(dir, opts \\ []), do: run(dir, ["branch", "--show-current"], opts)

  @spec status_porcelain(Path.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def status_porcelain(dir, opts \\ []), do: run(dir, ["status", "--porcelain"], opts)

  @doc """
  Whether the index has changes staged for commit. `git diff --cached --quiet`
  exits 0 with no staged changes and 1 when there are some. On any other error we
  assume there are changes so a commit is still attempted rather than silently
  dropped.
  """
  @spec staged_changes?(Path.t(), keyword()) :: boolean()
  def staged_changes?(dir, opts \\ []) do
    case run(dir, ["diff", "--cached", "--quiet"], opts) do
      {:ok, _} -> false
      {:error, {1, _}} -> true
      {:error, _} -> true
    end
  end

  @spec ensure_worktree(Path.t(), String.t(), keyword()) :: {:ok, Path.t()} | {:error, term()}
  def ensure_worktree(checkout, branch, opts \\ []) do
    path = Path.join([checkout, ".worktrees", branch])

    cond do
      not File.dir?(path) ->
        create_worktree(checkout, branch, path, opts)

      healthy_worktree?(path, opts) ->
        {:ok, path}

      # The worktree exists but its branch is unborn (no commits). This happens
      # when it was created from an unborn HEAD while the repository was still
      # being cloned (a clone/worktree race). Self-heal by rebuilding it from a
      # real base commit once one is available; if the repository is genuinely
      # empty (e.g. a brand-new general KB) keep the orphan branch so the first
      # write can seed it.
      base_available?(checkout, opts) ->
        heal_worktree(checkout, branch, path, opts)

      true ->
        {:ok, path}
    end
  end

  defp create_worktree(checkout, branch, path, opts) do
    File.mkdir_p!(Path.dirname(path))
    args = worktree_add_args(checkout, branch, path, opts)

    case run(checkout, args, opts) do
      {:ok, _} -> {:ok, path}
      {:error, reason} -> {:error, {:worktree_failed, reason}}
    end
  end

  # Tears down a broken (unborn) worktree, then recreates it from a valid base.
  # `worktree remove` is best-effort because an orphan worktree can refuse a
  # clean removal; the explicit delete + prune guarantees a recreatable state.
  defp heal_worktree(checkout, branch, path, opts) do
    _ = run(checkout, ["worktree", "remove", "--force", path], opts)
    if File.dir?(path), do: File.rm_rf!(path)
    _ = run(checkout, ["worktree", "prune"], opts)
    create_worktree(checkout, branch, path, opts)
  end

  # A worktree is healthy when its checked-out branch resolves to a commit.
  defp healthy_worktree?(path, opts) do
    match?({:ok, _}, run(path, ["rev-parse", "--verify", "--quiet", "HEAD"], opts))
  end

  # Whether a real base commit exists to branch the docs worktree from: either a
  # resolvable configured base branch or a born HEAD on the checkout.
  defp base_available?(checkout, opts) do
    not is_nil(base_ref(checkout, opts)) or head_born?(checkout, opts)
  end

  defp head_born?(checkout, opts), do: ref_exists?(checkout, "HEAD", opts)

  @spec add(Path.t(), [String.t()], keyword()) :: :ok | {:error, term()}
  def add(dir, paths, opts \\ []) when is_list(paths) do
    case run(dir, ["add", "--" | paths], opts) do
      {:ok, _} -> :ok
      error -> error
    end
  end

  @spec commit(Path.t(), String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def commit(dir, message, opts \\ []) do
    name = Keyword.get(opts, :name, "Symphony")
    email = Keyword.get(opts, :email, "symphony-kb@localhost")
    args = ["-c", "user.name=#{name}", "-c", "user.email=#{email}", "commit", "-m", message]

    with {:ok, _} <- run(dir, args, opts) do
      run(dir, ["rev-parse", "HEAD"], opts)
    end
  end

  @spec push(Path.t(), String.t(), keyword()) :: :ok | {:error, term()}
  def push(dir, branch, opts \\ []) do
    case push_once(dir, branch, opts) do
      {:ok, _} -> :ok
      {:error, reason} -> recover_push(dir, branch, reason, opts)
    end
  end

  defp push_once(dir, branch, opts), do: run(dir, ["push", "-u", "origin", branch], opts)

  defp recover_push(dir, branch, reason, opts) do
    if non_fast_forward_push?(reason) do
      with :ok <- fetch(dir, opts),
           {:ok, _merge_result} <- merge(dir, "origin/#{branch}", opts),
           {:ok, _} <- push_once(dir, branch, opts) do
        :ok
      else
        {:error, merge_or_push_reason} -> {:error, merge_or_push_reason}
      end
    else
      {:error, reason}
    end
  end

  defp non_fast_forward_push?({_status, output}) when is_binary(output) do
    output =~ "fetch first" or output =~ "non-fast-forward" or output =~ "Updates were rejected"
  end

  defp non_fast_forward_push?(_reason), do: false

  @spec fetch(Path.t(), keyword()) :: :ok | {:error, term()}
  def fetch(dir, opts \\ []) do
    case run(dir, ["fetch", "origin"], opts) do
      {:ok, _} -> :ok
      error -> error
    end
  end

  @doc """
  Counts commits reachable from `range` (e.g. `"origin/main..symphony-docs"`),
  i.e. how far the docs branch is ahead of its base. Zero means there is nothing
  to promote.
  """
  @spec rev_list_count(Path.t(), String.t(), keyword()) ::
          {:ok, non_neg_integer()} | {:error, term()}
  def rev_list_count(dir, range, opts \\ []) when is_binary(range) do
    case run(dir, ["rev-list", "--count", range], opts) do
      {:ok, output} ->
        case Integer.parse(String.trim(output)) do
          {count, _rest} -> {:ok, count}
          :error -> {:error, {:invalid_count, output}}
        end

      error ->
        error
    end
  end

  @spec merge(Path.t(), String.t(), keyword()) ::
          {:ok, :merged | :up_to_date} | {:error, :merge_conflict | term()}
  def merge(dir, ref, opts \\ []) do
    name = Keyword.get(opts, :name, "Symphony")
    email = Keyword.get(opts, :email, "symphony-kb@localhost")
    args = ["-c", "user.name=#{name}", "-c", "user.email=#{email}", "merge", "--no-edit", ref]

    case run(dir, args, opts) do
      {:ok, output} ->
        {:ok, if(output =~ "Already up to date", do: :up_to_date, else: :merged)}

      {:error, {_status, output}} ->
        if output =~ "CONFLICT" or output =~ "Automatic merge failed" do
          _ = abort_merge(dir, opts)
          {:error, :merge_conflict}
        else
          {:error, {:merge_failed, output}}
        end
    end
  end

  @spec abort_merge(Path.t(), keyword()) :: :ok | {:error, term()}
  def abort_merge(dir, opts \\ []) do
    case run(dir, ["merge", "--abort"], opts) do
      {:ok, _} -> :ok
      error -> error
    end
  end

  # Creates the docs worktree. When the docs branch does not exist yet it is
  # branched from the repository's configured branch (`:base_branch`, e.g. the
  # setup-yaml `selected_branch`), preferring the fetched `origin/<branch>` so the
  # docs tree matches what lives on GitHub. Falls back to current HEAD when no
  # base branch is resolvable.
  defp worktree_add_args(checkout, branch, path, opts) do
    if branch_exists?(checkout, branch, opts) do
      ["worktree", "add", path, branch]
    else
      case base_ref(checkout, opts) do
        nil -> ["worktree", "add", "-b", branch, path]
        base -> ["worktree", "add", "-b", branch, path, base]
      end
    end
  end

  defp base_ref(checkout, opts) do
    base = Keyword.get(opts, :base_branch)

    cond do
      not (is_binary(base) and base != "") -> nil
      ref_exists?(checkout, "refs/remotes/origin/#{base}", opts) -> "origin/#{base}"
      ref_exists?(checkout, "refs/heads/#{base}", opts) -> base
      true -> nil
    end
  end

  defp branch_exists?(checkout, branch, opts),
    do: ref_exists?(checkout, "refs/heads/#{branch}", opts)

  defp ref_exists?(checkout, ref, opts) do
    match?({:ok, _}, run(checkout, ["rev-parse", "--verify", "--quiet", ref], opts))
  end
end
