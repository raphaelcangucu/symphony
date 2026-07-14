defmodule SymphonyElixir.Workspace.PathOwnership do
  @moduledoc """
  Validates that an existing path is an exact current inventory entry owned by
  a configured project workspace root.

  Validation is read-only and fails closed for missing, non-directory, or
  symlinked path components.
  """

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workspace
  alias SymphonyElixir.Workspace.Inventory

  @inventory_module_env :workspace_display_name_inventory_module

  @type validation_reason ::
          :invalid_workspace_path | :workspace_path_not_owned | :workspace_issue_mismatch
  @type entry_type :: :workspace | :child_worktree
  @type validation_result :: %{
          optional(:workspace_kind) => String.t(),
          path: Path.t(),
          entry: map(),
          entry_type: entry_type(),
          workspace_entry: map()
        }
  @type error ::
          :project_not_found
          | {:validation, validation_reason()}
          | {:inventory, term()}

  @doc """
  Validates and canonicalizes a project-owned workspace inventory path.

  `:inventory_module` may be supplied for deterministic callers and tests. The
  module must expose `scan/1`.
  """
  @spec validate(String.t(), term(), keyword()) :: {:ok, validation_result()} | {:error, error()}
  def validate(project_slug, requested_path, opts \\ [])

  def validate(project_slug, requested_path, opts)
      when is_binary(project_slug) and is_list(opts) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, normalized_path} <- normalize_path(requested_path),
         project_root <- project_workspace_root(project_slug),
         :ok <- validate_owned_path_candidate(normalized_path, project_root),
         {:ok, scan} <- scan_inventory(project_slug, opts),
         {:ok, result} <- find_exact_entry(scan, normalized_path) do
      {:ok, result}
    end
  end

  def validate(_project_slug, _requested_path, _opts),
    do: {:error, {:validation, :invalid_workspace_path}}

  @doc """
  Validates an exact issue workspace and derives trusted session metadata.

  Only canonical (`:issue`) and parallel (`:issue_parallel`) top-level inventory
  entries owned by `issue_identifier` are accepted.
  """
  @spec validate_issue(String.t(), term(), term(), keyword()) ::
          {:ok, validation_result()} | {:error, error()}
  def validate_issue(project_slug, requested_path, issue_identifier, opts \\ [])

  def validate_issue(project_slug, requested_path, issue_identifier, opts)
      when is_binary(issue_identifier) and is_list(opts) do
    normalized_identifier = String.trim(issue_identifier)

    with true <- normalized_identifier != "" || {:error, {:validation, :workspace_issue_mismatch}},
         {:ok, ownership} <- validate(project_slug, requested_path, opts),
         {:ok, workspace_kind} <- issue_workspace_kind(ownership, normalized_identifier) do
      {:ok, Map.put(ownership, :workspace_kind, workspace_kind)}
    end
  end

  def validate_issue(_project_slug, _requested_path, _issue_identifier, _opts),
    do: {:error, {:validation, :workspace_issue_mismatch}}

  @doc "Canonicalizes an absolute workspace path without touching the filesystem."
  @spec normalize_path(term()) :: {:ok, Path.t()} | {:error, {:validation, :invalid_workspace_path}}
  def normalize_path(requested_path) when is_binary(requested_path) do
    trimmed_path = String.trim(requested_path)

    cond do
      trimmed_path == "" ->
        {:error, {:validation, :invalid_workspace_path}}

      String.contains?(trimmed_path, <<0>>) ->
        {:error, {:validation, :invalid_workspace_path}}

      Path.type(trimmed_path) != :absolute ->
        {:error, {:validation, :invalid_workspace_path}}

      true ->
        {:ok, Path.expand(trimmed_path)}
    end
  end

  def normalize_path(_requested_path), do: {:error, {:validation, :invalid_workspace_path}}

  defp project_workspace_root(project_slug) do
    %{root: root, segment: segment} = Workspace.project_layout(project_slug)

    case segment do
      segment when is_binary(segment) and segment != "" -> Path.expand(Path.join(root, segment))
      _segment -> Path.expand(root)
    end
  end

  defp validate_owned_path_candidate(workspace_path, project_root) do
    if contained_path?(workspace_path, project_root) do
      validate_path_components(workspace_path, project_root)
    else
      {:error, {:validation, :workspace_path_not_owned}}
    end
  end

  defp contained_path?(path, root) do
    case Path.relative_to(path, root) do
      "." -> true
      relative_path -> not Enum.member?(Path.split(relative_path), "..")
    end
  end

  defp validate_path_components(workspace_path, project_root) do
    relative_path = Path.relative_to(workspace_path, project_root)
    segments = if relative_path == ".", do: [], else: Path.split(relative_path)

    [project_root | segments]
    |> Enum.reduce_while({:ok, project_root}, fn
      ^project_root, {:ok, _current_path} ->
        continue_for_directory(project_root)

      segment, {:ok, current_path} ->
        current_path
        |> Path.join(segment)
        |> continue_for_directory()
    end)
    |> case do
      {:ok, _path} -> :ok
      {:error, {:validation, :workspace_path_not_owned}} = error -> error
    end
  end

  defp continue_for_directory(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :directory}} -> {:cont, {:ok, path}}
      _missing_symlink_or_non_directory -> {:halt, {:error, {:validation, :workspace_path_not_owned}}}
    end
  end

  defp scan_inventory(project_slug, opts) do
    inventory_module = Keyword.get_lazy(opts, :inventory_module, &configured_inventory_module/0)

    case inventory_module.scan(project_slug) do
      {:ok, %{workspaces: workspaces} = scan} when is_list(workspaces) -> {:ok, scan}
      {:error, reason} -> {:error, {:inventory, reason}}
      other -> {:error, {:inventory, {:invalid_scan_result, other}}}
    end
  rescue
    error -> {:error, {:inventory, {:scan_exception, error}}}
  catch
    kind, reason -> {:error, {:inventory, {kind, reason}}}
  end

  defp configured_inventory_module do
    Application.get_env(:symphony_elixir, @inventory_module_env, Inventory)
  end

  defp find_exact_entry(%{workspaces: workspaces}, requested_path) do
    Enum.find_value(workspaces, {:error, {:validation, :workspace_path_not_owned}}, fn workspace ->
      cond do
        exact_path?(Map.get(workspace, :path), requested_path) ->
          {:ok,
           %{
             path: requested_path,
             entry: workspace,
             entry_type: :workspace,
             workspace_entry: workspace
           }}

        child = exact_child_entry(workspace, requested_path) ->
          {:ok,
           %{
             path: requested_path,
             entry: child,
             entry_type: :child_worktree,
             workspace_entry: workspace
           }}

        true ->
          false
      end
    end)
  end

  defp exact_child_entry(workspace, requested_path) do
    workspace
    |> Map.get(:child_worktrees, [])
    |> Enum.find(&exact_path?(Map.get(&1, :path), requested_path))
  end

  defp exact_path?(path, requested_path) when is_binary(path) do
    not String.contains?(path, <<0>>) and Path.expand(path) == requested_path
  end

  defp exact_path?(_path, _requested_path), do: false

  defp issue_workspace_kind(
         %{entry_type: :workspace, entry: %{kind: :issue, issue_identifier: issue_identifier}},
         issue_identifier
       ),
       do: {:ok, "shared"}

  defp issue_workspace_kind(
         %{entry_type: :workspace, entry: %{kind: :issue_parallel, issue_identifier: issue_identifier}},
         issue_identifier
       ),
       do: {:ok, "isolated"}

  defp issue_workspace_kind(_ownership, _issue_identifier),
    do: {:error, {:validation, :workspace_issue_mismatch}}
end
