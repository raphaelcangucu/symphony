defmodule SymphonyElixir.MobileRpc.MobileGitService do
  @moduledoc """
  Maps Orca's source-control DTOs onto a selected Symphony worktree.

  Every subprocess is a fixed `git` executable with server-authored arguments.
  Mobile input can select a validated worktree, path, ref or message, but can
  never supply a command or executable.
  """

  alias SymphonyElixir.Assistant.History

  @status_limit 5_000
  @diff_limit 2 * 1024 * 1024
  @message_limit 10_000
  @hex_oid ~r/\A(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})\z/
  @safe_ref ~r/\A[A-Za-z0-9][A-Za-z0-9._\/-]*\z/

  @spec call(String.t(), map(), map()) :: {:ok, term()} | {:error, term()}
  def call("git.status", %{"worktree" => selector}, context) do
    with {:ok, _thread, root} <- resolve_repo(selector, context),
         {:ok, output} <- git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
         {:ok, head} <- optional_git(root, ["rev-parse", "HEAD"]),
         {:ok, branch} <- optional_git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) do
      all_entries = parse_porcelain(output)
      visible = Enum.take(all_entries, @status_limit)

      {:ok,
       %{
         "entries" => visible,
         "conflictOperation" => conflict_operation(root),
         "head" => blank_to_nil(head),
         "branch" => blank_to_nil(branch),
         "upstreamStatus" => upstream_status(root),
         "didHitLimit" => length(all_entries) > length(visible),
         "statusLength" => length(all_entries)
       }}
    else
      {:error, reason} -> git_error(reason)
    end
  end

  def call(
        "git.diff",
        %{"worktree" => selector, "filePath" => file_path, "staged" => staged},
        context
      )
      when is_boolean(staged) do
    with {:ok, _thread, root} <- resolve_repo(selector, context),
         {:ok, path} <- validate_path(file_path),
         {:ok, original} <- diff_original(root, path, staged),
         {:ok, modified} <- diff_modified(root, path, staged) do
      present_diff(original, modified)
    else
      {:error, reason} -> git_error(reason)
    end
  end

  def call(
        "git.branchDiff",
        %{
          "worktree" => selector,
          "filePath" => file_path,
          "compare" => %{"headOid" => head, "mergeBase" => merge_base}
        } = params,
        context
      ) do
    with {:ok, _thread, root} <- resolve_repo(selector, context),
         :ok <- validate_oid(head),
         :ok <- validate_oid(merge_base),
         {:ok, path} <- validate_path(file_path),
         {:ok, old_path} <- validate_optional_path(Map.get(params, "oldPath")),
         {:ok, original} <- git_file(root, merge_base, old_path || path),
         {:ok, modified} <- git_file(root, head, path) do
      present_diff(original, modified)
    else
      {:error, reason} -> git_error(reason)
    end
  end

  def call(
        "git.branchCompare",
        %{"worktree" => selector, "baseRef" => base_ref},
        context
      ) do
    with {:ok, _thread, root} <- resolve_repo(selector, context),
         :ok <- validate_ref(base_ref),
         {:ok, base_oid} <- git(root, ["rev-parse", "--verify", "#{base_ref}^{commit}"]),
         {:ok, head_oid} <- git(root, ["rev-parse", "HEAD"]),
         {:ok, merge_base} <- git(root, ["merge-base", base_oid, head_oid]),
         {:ok, entries} <- compare_entries(root, "#{merge_base}..#{head_oid}"),
         {:ok, ahead_text} <- git(root, ["rev-list", "--count", "#{merge_base}..#{head_oid}"]) do
      {:ok,
       %{
         "summary" => %{
           "baseRef" => base_ref,
           "baseOid" => base_oid,
           "compareRef" => "HEAD",
           "headOid" => head_oid,
           "mergeBase" => merge_base,
           "changedFiles" => length(entries),
           "commitsAhead" => parse_non_negative(ahead_text),
           "status" => "ready"
         },
         "entries" => entries
       }}
    else
      {:error, reason} -> git_error(reason)
    end
  end

  def call(
        "git.commitCompare",
        %{"worktree" => selector, "commitId" => commit_id},
        context
      ) do
    with {:ok, _thread, root} <- resolve_repo(selector, context),
         :ok <- validate_oid(commit_id),
         {:ok, commit_oid} <- git(root, ["rev-parse", "--verify", "#{commit_id}^{commit}"]),
         {:ok, parents} <- git(root, ["rev-list", "--parents", "-n", "1", commit_oid]),
         parent_oid = parents |> String.split() |> Enum.at(1),
         {:ok, entries} <-
           compare_entries(
             root,
             if(parent_oid, do: "#{parent_oid}..#{commit_oid}", else: commit_oid),
             root_commit: is_nil(parent_oid)
           ) do
      {:ok,
       %{
         "summary" => %{
           "commitOid" => commit_oid,
           "parentOid" => parent_oid,
           "compareRef" => commit_oid,
           "baseRef" => parent_oid || "empty tree",
           "changedFiles" => length(entries),
           "status" => "ready"
         },
         "entries" => entries
       }}
    else
      {:error, reason} -> git_error(reason)
    end
  end

  def call("git.history", %{"worktree" => selector} = params, context) do
    limit = bounded_limit(Map.get(params, "limit", 50), 1, 200)

    with {:ok, _thread, root} <- resolve_repo(selector, context),
         {:ok, output} <-
           git(root, [
             "log",
             "-n",
             Integer.to_string(limit + 1),
             "--pretty=format:%H%x1f%P%x1f%s%x1f%an%x1f%ae%x1f%ct%x1e"
           ]) do
      parsed = parse_history(output)
      items = Enum.take(parsed, limit)

      {:ok,
       %{
         "items" => items,
         "hasIncomingChanges" => upstream_status(root)["behind"] > 0,
         "hasOutgoingChanges" => upstream_status(root)["ahead"] > 0,
         "hasMore" => length(parsed) > length(items),
         "limit" => limit
       }}
    else
      {:error, reason} -> git_error(reason)
    end
  end

  def call(
        "git.stage",
        %{"worktree" => selector, "filePath" => file_path},
        context
      ) do
    with {:ok, _thread, root} <- resolve_repo(selector, context),
         {:ok, path} <- validate_path(file_path),
         {:ok, _output} <- git(root, ["add", "--", path]) do
      {:ok, %{"staged" => true, "filePath" => path}}
    else
      {:error, reason} -> git_error(reason)
    end
  end

  def call(
        "git.commit",
        %{"worktree" => selector, "message" => message},
        context
      )
      when is_binary(message) do
    with {:ok, normalized} <- validate_message(message),
         {:ok, _thread, root} <- resolve_repo(selector, context),
         {:ok, head_before} <- git(root, ["rev-parse", "HEAD"]) do
      case git_status(root, ["diff", "--cached", "--quiet", "--exit-code"]) do
        0 ->
          {:ok,
           %{
             "success" => true,
             "committed" => false,
             "sha" => head_before,
             "message" => normalized
           }}

        1 ->
          with {:ok, _output} <- git(root, ["commit", "--no-gpg-sign", "-m", normalized]),
               {:ok, sha} <- git(root, ["rev-parse", "HEAD"]) do
            {:ok,
             %{
               "success" => true,
               "committed" => true,
               "sha" => sha,
               "message" => normalized
             }}
          else
            {:error, reason} -> git_error(reason)
          end

        _status ->
          rpc_error("commit_failed", "Unable to inspect staged changes")
      end
    else
      {:error, reason} -> git_error(reason)
    end
  end

  def call("git.push", %{"worktree" => selector} = params, context) do
    with {:ok, _thread, root} <- resolve_repo(selector, context),
         {:ok, args} <- push_args(root, params),
         :ok <- run_push(root, args, context) do
      {:ok, %{"pushed" => true}}
    else
      {:error, {:push_failed, message}} ->
        rpc_error("push_failed", "Push failed: #{normalize_error(message)}", true)

      {:error, reason} ->
        git_error(reason)
    end
  end

  def call("git.generateCommitMessage", %{"worktree" => selector}, context) do
    with {:ok, _thread, root} <- resolve_repo(selector, context) do
      generator = Map.get(context, :orca_git_generate_commit_message)

      result =
        if is_function(generator, 1),
          do: generator.(root),
          else: {:ok, fallback_commit_message(root)}

      case result do
        {:ok, message} when is_binary(message) and message != "" ->
          {:ok, %{"success" => true, "message" => message}}

        {:error, reason} ->
          {:ok, %{"success" => false, "error" => normalize_error(reason)}}
      end
    end
  end

  def call("git.cancelGenerateCommitMessage", %{"worktree" => selector}, context) do
    with {:ok, _thread, _root} <- resolve_repo(selector, context) do
      {:ok, %{"canceled" => true}}
    end
  end

  def call("git.generatePullRequestFields", %{"worktree" => selector} = params, context) do
    with {:ok, _thread, root} <- resolve_repo(selector, context) do
      generator = Map.get(context, :orca_git_generate_pull_request_fields)

      fields =
        if is_function(generator, 2) do
          generator.(root, params)
        else
          {:ok, fallback_pr_fields(root, params)}
        end

      case fields do
        {:ok, value} when is_map(value) -> {:ok, %{"success" => true, "fields" => value}}
        {:error, reason} -> {:ok, %{"success" => false, "error" => normalize_error(reason)}}
      end
    end
  end

  def call(
        "hostedReview.getCreationEligibility",
        %{"branch" => branch} = params,
        context
      ) do
    with selector when is_binary(selector) <- Map.get(params, "worktree"),
         {:ok, _thread, root} <- resolve_repo(selector, context) do
      {:ok, hosted_review_eligibility(root, branch, params)}
    else
      _missing -> capability_unavailable("Hosted review")
    end
  end

  def call(_method, _params, _context), do: {:error, :unsupported_orca_git_method}

  defp resolve_repo(selector, context) do
    result =
      case Map.get(context, :orca_workspace_resolver) do
        resolver when is_function(resolver, 1) -> resolver.(selector)
        _absent -> resolve_from_history(selector)
      end

    with {:ok, thread} <- result,
         root when is_binary(root) and root != "" <- Map.get(thread, :workspace_path),
         root = Path.expand(root),
         true <- File.dir?(root),
         {:ok, git_root} <- git(root, ["rev-parse", "--show-toplevel"]),
         expanded_git_root = Path.expand(git_root),
         true <- inside?(root, expanded_git_root) do
      {:ok, thread, expanded_git_root}
    else
      _error -> rpc_error("not_found", "Symphony Git worktree was not found")
    end
  end

  defp resolve_from_history(selector) do
    raw = selector |> to_string() |> String.replace_prefix("id:", "")

    with {id, ""} when id > 0 <- Integer.parse(raw),
         {:ok, thread} <- History.get_thread(id) do
      {:ok, thread}
    else
      _error -> {:error, :not_found}
    end
  end

  defp inside?(root, path) do
    relative = Path.relative_to(path, root)
    relative == "." or not Enum.any?(Path.split(relative), &(&1 == ".."))
  end

  defp validate_path(value) when is_binary(value) do
    normalized = String.replace(value, "\\", "/")

    cond do
      normalized == "" -> {:error, :invalid_path}
      Path.type(normalized) == :absolute -> {:error, :invalid_path}
      String.starts_with?(normalized, "-") -> {:error, :invalid_path}
      String.contains?(normalized, <<0>>) -> {:error, :invalid_path}
      String.contains?(normalized, ":") -> {:error, :invalid_path}
      Enum.any?(Path.split(normalized), &(&1 in [".", ".."])) -> {:error, :invalid_path}
      true -> {:ok, normalized}
    end
  end

  defp validate_path(_value), do: {:error, :invalid_path}
  defp validate_optional_path(nil), do: {:ok, nil}
  defp validate_optional_path(value), do: validate_path(value)

  defp validate_ref(ref) when is_binary(ref) do
    if Regex.match?(@safe_ref, ref) and not String.contains?(ref, ["..", "@{"]) and
         not String.ends_with?(ref, [".", "/", ".lock"]),
       do: :ok,
       else: {:error, :invalid_ref}
  end

  defp validate_ref(_ref), do: {:error, :invalid_ref}

  defp validate_oid(oid) when is_binary(oid) do
    if Regex.match?(@hex_oid, oid), do: :ok, else: {:error, :invalid_oid}
  end

  defp validate_oid(_oid), do: {:error, :invalid_oid}

  defp validate_message(message) do
    normalized = String.trim(message)

    cond do
      normalized == "" -> {:error, :invalid_commit_message}
      byte_size(normalized) > @message_limit -> {:error, :invalid_commit_message}
      String.contains?(normalized, <<0>>) -> {:error, :invalid_commit_message}
      true -> {:ok, normalized}
    end
  end

  defp parse_porcelain(output) do
    output
    |> String.split(<<0>>, trim: true)
    |> Enum.flat_map(&parse_porcelain_token/1)
  end

  defp parse_porcelain_token(token) when byte_size(token) >= 4 do
    x = String.at(token, 0)
    y = String.at(token, 1)
    path = String.slice(token, 3..-1//1)

    cond do
      x == "?" and y == "?" ->
        [%{"path" => path, "status" => "untracked", "area" => "untracked"}]

      conflict_code?(x <> y) ->
        [
          %{
            "path" => path,
            "status" => "modified",
            "area" => "unstaged",
            "conflictStatus" => "unresolved"
          }
        ]

      true ->
        staged = status_entry(path, x, "staged")
        unstaged = status_entry(path, y, "unstaged")
        Enum.reject([staged, unstaged], &is_nil/1)
    end
  end

  defp parse_porcelain_token(_token), do: []

  defp status_entry(_path, code, _area) when code in [" ", "?", nil], do: nil

  defp status_entry(path, code, area) do
    %{
      "path" => normalize_rename_path(path),
      "status" => status_name(code),
      "area" => area
    }
    |> maybe_old_path(path, code)
  end

  defp status_name("A"), do: "added"
  defp status_name("D"), do: "deleted"
  defp status_name("R"), do: "renamed"
  defp status_name("C"), do: "copied"
  defp status_name(_code), do: "modified"

  defp normalize_rename_path(path) do
    case String.split(path, " -> ", parts: 2) do
      [_old, current] -> current
      [current] -> current
    end
  end

  defp maybe_old_path(entry, path, code) when code in ["R", "C"] do
    case String.split(path, " -> ", parts: 2) do
      [old, _current] -> Map.put(entry, "oldPath", old)
      _single -> entry
    end
  end

  defp maybe_old_path(entry, _path, _code), do: entry

  defp conflict_code?(code), do: code in ~w(DD AU UD UA DU AA UU)

  defp conflict_operation(root) do
    git_dir =
      case optional_git(root, ["rev-parse", "--git-dir"]) do
        {:ok, value} when is_binary(value) and value != "" -> Path.expand(value, root)
        _error -> Path.join(root, ".git")
      end

    cond do
      File.exists?(Path.join(git_dir, "MERGE_HEAD")) -> "merge"
      File.dir?(Path.join(git_dir, "rebase-merge")) -> "rebase"
      File.dir?(Path.join(git_dir, "rebase-apply")) -> "rebase"
      File.exists?(Path.join(git_dir, "CHERRY_PICK_HEAD")) -> "cherry-pick"
      true -> "unknown"
    end
  end

  defp upstream_status(root) do
    case optional_git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]) do
      {:ok, upstream} when is_binary(upstream) and upstream != "" ->
        {ahead, behind} =
          case optional_git(root, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]) do
            {:ok, counts} ->
              case String.split(counts) do
                [left, right] -> {parse_non_negative(left), parse_non_negative(right)}
                _invalid -> {0, 0}
              end

            _error ->
              {0, 0}
          end

        %{
          "hasUpstream" => true,
          "upstreamName" => upstream,
          "ahead" => ahead,
          "behind" => behind
        }

      _missing ->
        %{"hasUpstream" => false, "ahead" => 0, "behind" => 0}
    end
  end

  defp diff_original(root, path, true), do: git_file(root, "HEAD", path)
  defp diff_original(root, path, false), do: git_index_file(root, path)
  defp diff_modified(root, path, true), do: git_index_file(root, path)
  defp diff_modified(root, path, false), do: worktree_file(root, path)

  defp git_index_file(root, path) do
    case git_raw(root, ["show", ":#{path}"]) do
      {:ok, content} -> {:ok, content}
      {:error, _reason} -> {:ok, ""}
    end
  end

  defp git_file(root, ref, path) do
    case git_raw(root, ["show", "#{ref}:#{path}"]) do
      {:ok, content} -> {:ok, content}
      {:error, _reason} -> {:ok, ""}
    end
  end

  defp worktree_file(root, path) do
    full = Path.join(root, path)

    case File.stat(full) do
      {:ok, %{type: :regular, size: size}} when size <= @diff_limit -> File.read(full)
      {:ok, %{type: :regular}} -> {:error, :diff_too_large}
      {:error, :enoent} -> {:ok, ""}
      {:error, reason} -> {:error, reason}
      _other -> {:error, :not_a_file}
    end
  end

  defp present_diff(original, modified) do
    cond do
      byte_size(original) > @diff_limit or byte_size(modified) > @diff_limit ->
        {:ok,
         %{
           "kind" => "too-large",
           "byteLength" => max(byte_size(original), byte_size(modified))
         }}

      binary?(original) or binary?(modified) ->
        {:ok,
         %{
           "kind" => "binary",
           "originalContent" => "",
           "modifiedContent" => "",
           "originalIsBinary" => binary?(original),
           "modifiedIsBinary" => binary?(modified)
         }}

      true ->
        {:ok,
         %{
           "kind" => "text",
           "originalContent" => original,
           "modifiedContent" => modified,
           "originalIsBinary" => false,
           "modifiedIsBinary" => false
         }}
    end
  end

  defp binary?(content), do: :binary.match(content, <<0>>) != :nomatch

  defp compare_entries(root, range, opts \\ []) do
    args =
      if Keyword.get(opts, :root_commit, false),
        do: ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", range],
        else: ["diff", "--name-status", range, "--"]

    with {:ok, output} <- git(root, args) do
      entries =
        output
        |> String.split("\n", trim: true)
        |> Enum.flat_map(&parse_name_status/1)

      {:ok, entries}
    end
  end

  defp parse_name_status(line) do
    case String.split(line, "\t") do
      [code, path] ->
        [%{"path" => path, "status" => status_name(String.first(code))}]

      [code, old_path, path] ->
        if String.first(code) in ["R", "C"] do
          [
            %{
              "path" => path,
              "oldPath" => old_path,
              "status" => status_name(String.first(code))
            }
          ]
        else
          []
        end

      _invalid ->
        []
    end
  end

  defp parse_history(output) do
    output
    |> String.split(<<30>>, trim: true)
    |> Enum.flat_map(fn record ->
      case String.split(String.trim(record), <<31>>) do
        [id, parents, subject, author, email, timestamp] ->
          [
            %{
              "id" => id,
              "displayId" => String.slice(id, 0, 7),
              "parentIds" => String.split(parents, " ", trim: true),
              "subject" => subject,
              "message" => subject,
              "author" => author,
              "authorEmail" => email,
              "timestamp" => parse_non_negative(timestamp)
            }
          ]

        _invalid ->
          []
      end
    end)
  end

  defp push_args(root, params) do
    force = Map.get(params, "forceWithLease") == true
    publish = Map.get(params, "publish") == true
    target = Map.get(params, "pushTarget")

    base = ["push"] ++ if(force, do: ["--force-with-lease"], else: [])

    case target do
      %{"remoteName" => remote, "branchName" => branch} ->
        with :ok <- validate_ref(remote),
             :ok <- validate_ref(branch) do
          {:ok, base ++ if(publish, do: ["-u"], else: []) ++ [remote, branch]}
        end

      nil ->
        if publish do
          with {:ok, branch} <- optional_git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
               :ok <- validate_ref(branch) do
            {:ok, base ++ ["-u", "origin", branch]}
          end
        else
          {:ok, base}
        end

      _invalid ->
        {:error, :invalid_push_target}
    end
  end

  defp run_push(root, args, context) do
    case Map.get(context, :orca_git_push) do
      function when is_function(function, 2) ->
        case function.(root, args) do
          :ok -> :ok
          {:ok, _output} -> :ok
          {:error, reason} -> {:error, {:push_failed, reason}}
        end

      _absent ->
        case git(root, args) do
          {:ok, _output} -> :ok
          {:error, {_status, output}} -> {:error, {:push_failed, output}}
          {:error, reason} -> {:error, {:push_failed, reason}}
        end
    end
  end

  defp fallback_commit_message(root) do
    case git(root, ["diff", "--cached", "--name-only", "--"]) do
      {:ok, output} ->
        count = output |> String.split("\n", trim: true) |> length()

        case count do
          0 -> "chore: update Dev10x workspace"
          1 -> "chore: update staged file"
          n -> "chore: update #{n} staged files"
        end

      _error ->
        "chore: update Dev10x workspace"
    end
  end

  defp fallback_pr_fields(root, params) do
    branch =
      case optional_git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) do
        {:ok, value} when is_binary(value) and value != "" -> value
        _error -> "Dev10x changes"
      end

    title =
      params
      |> Map.get("title", "")
      |> to_string()
      |> String.trim()
      |> case do
        "" -> branch |> String.replace(["-", "_", "/"], " ") |> String.capitalize()
        value -> value
      end

    body =
      params
      |> Map.get("body", "")
      |> to_string()
      |> String.trim()
      |> case do
        "" -> "## Summary\n\n- Update #{branch}\n\nGenerated by Dev10x."
        value -> value
      end

    %{
      "base" => Map.get(params, "base", "main"),
      "title" => title,
      "body" => body,
      "draft" => Map.get(params, "draft", false) == true
    }
  end

  defp hosted_review_eligibility(root, branch, params) do
    remote =
      case optional_git(root, ["remote", "get-url", "origin"]) do
        {:ok, value} when is_binary(value) -> value
        _error -> ""
      end

    provider = if String.contains?(remote, "github.com"), do: "github", else: "unsupported"
    upstream = upstream_status(root)
    has_uncommitted = Map.get(params, "hasUncommittedChanges", status_dirty?(root))
    has_upstream = Map.get(params, "hasUpstream", upstream["hasUpstream"])
    ahead = Map.get(params, "ahead", upstream["ahead"])
    behind = Map.get(params, "behind", upstream["behind"])
    base = Map.get(params, "base") || default_base(root)
    linked = Map.get(params, "linkedGitHubPR") || Map.get(params, "fallbackGitHubPR")

    {blocked, next_action} =
      cond do
        provider == "unsupported" -> {"unsupported_provider", nil}
        is_integer(linked) -> {"existing_review", "open_existing_review"}
        branch in [nil, ""] -> {"detached_head", nil}
        branch == base -> {"default_branch", nil}
        has_uncommitted -> {"dirty", "commit"}
        behind > 0 -> {"needs_sync", "sync"}
        not has_upstream -> {"no_upstream", "publish"}
        ahead > 0 -> {"needs_push", "push"}
        true -> {nil, nil}
      end

    %{
      "provider" => provider,
      "review" => nil,
      "canCreate" => is_nil(blocked),
      "blockedReason" => blocked,
      "nextAction" => next_action,
      "defaultBaseRef" => base,
      "head" => branch,
      "title" => branch |> to_string() |> String.replace(["-", "_", "/"], " ") |> String.capitalize(),
      "body" => ""
    }
  end

  defp status_dirty?(root) do
    case git(root, ["status", "--porcelain=v1", "--untracked-files=all"]) do
      {:ok, output} -> String.trim(output) != ""
      _error -> false
    end
  end

  defp default_base(root) do
    case optional_git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) do
      {:ok, "origin/" <> branch} -> branch
      _error -> "main"
    end
  end

  defp git(root, args) do
    case System.cmd("git", args, cd: root, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim_trailing(output)}
      {output, status} -> {:error, {status, String.trim(output)}}
    end
  rescue
    error -> {:error, error}
  end

  defp git_raw(root, args) do
    case System.cmd("git", args, cd: root, stderr_to_stdout: true) do
      {output, 0} -> {:ok, output}
      {output, status} -> {:error, {status, String.trim(output)}}
    end
  rescue
    error -> {:error, error}
  end

  defp optional_git(root, args) do
    case git(root, args) do
      {:ok, output} -> {:ok, output}
      {:error, _reason} -> {:ok, nil}
    end
  end

  defp git_status(root, args) do
    case System.cmd("git", args, cd: root, stderr_to_stdout: true) do
      {_output, status} -> status
    end
  rescue
    _error -> 128
  end

  defp bounded_limit(value, min, max) when is_integer(value), do: value |> Kernel.max(min) |> Kernel.min(max)
  defp bounded_limit(_value, min, _max), do: min

  defp parse_non_negative(value) do
    case Integer.parse(to_string(value)) do
      {number, _rest} when number >= 0 -> number
      _invalid -> 0
    end
  end

  defp blank_to_nil(nil), do: nil
  defp blank_to_nil(""), do: nil
  defp blank_to_nil(value), do: value

  defp normalize_error({_status, output}), do: normalize_error(output)
  defp normalize_error(%{message: message}) when is_binary(message), do: message
  defp normalize_error(error) when is_binary(error), do: String.trim(error)
  defp normalize_error(error), do: inspect(error)

  defp capability_unavailable(feature),
    do: rpc_error("capability_unavailable", "#{feature} is unavailable on this Symphony host")

  defp git_error({:rpc_error, _code, _message, _retryable, _data} = error), do: {:error, error}
  defp git_error(:invalid_path), do: rpc_error("invalid_path", "Git path is invalid")
  defp git_error(:invalid_ref), do: rpc_error("invalid_ref", "Git ref is invalid")
  defp git_error(:invalid_oid), do: rpc_error("invalid_oid", "Git object id is invalid")
  defp git_error(:invalid_commit_message), do: rpc_error("invalid_commit_message", "Commit message is invalid")
  defp git_error(:invalid_push_target), do: rpc_error("invalid_push_target", "Push target is invalid")
  defp git_error(:diff_too_large), do: rpc_error("diff_too_large", "Diff is too large")
  defp git_error(reason), do: rpc_error("git_failed", "Git operation failed: #{normalize_error(reason)}")

  defp rpc_error(code, message, retryable \\ false),
    do: {:error, {:rpc_error, code, message, retryable, nil}}
end
