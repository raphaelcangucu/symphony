defmodule SymphonyElixir.Codex.Config do
  @moduledoc """
  Codex-specific configuration read from the `codex:` YAML section.
  """

  @behaviour SymphonyElixir.AgentConfig

  # Codex app-server only accepts these `approvalPolicy` variants:
  # `untrusted`, `on-failure`, `on-request`, `granular`, `never`. The safe
  # default when a project does not configure one is `untrusted` (ask before
  # running untrusted commands). A previous default sent an object keyed
  # `reject`, which the current app-server rejects with
  # `unknown variant `reject``.
  @default_approval_policy "untrusted"
  @default_thread_sandbox "workspace-write"

  @spec command(map()) :: String.t()
  def command(section \\ codex_section()) do
    case Map.get(section, "command") do
      value when is_binary(value) and value != "" -> String.trim(value)
      _ -> SymphonyElixir.InstanceConfig.codex_command()
    end
  end

  @spec approval_policy(map()) :: String.t() | map()
  def approval_policy(section \\ codex_section()) do
    case resolve_approval_policy(section) do
      {:ok, value} -> value
      {:error, _} -> @default_approval_policy
    end
  end

  @spec thread_sandbox(map()) :: String.t()
  def thread_sandbox(section \\ codex_section()) do
    case resolve_thread_sandbox(section) do
      {:ok, value} -> value
      {:error, _} -> @default_thread_sandbox
    end
  end

  @spec goals_enabled?(map()) :: boolean()
  def goals_enabled?(section \\ codex_section()) do
    Map.get(section, "goals_enabled") == true
  end

  @spec turn_sandbox_policy(map(), Path.t() | nil) :: map()
  def turn_sandbox_policy(section \\ codex_section(), workspace \\ nil) do
    case resolve_turn_sandbox_policy(section, workspace) do
      {:ok, value} -> value
      {:error, _} -> default_turn_sandbox_policy(workspace)
    end
  end

  @spec runtime_settings(map(), Path.t() | nil) :: {:ok, map()} | {:error, term()}
  def runtime_settings(section \\ codex_section(), workspace \\ nil) do
    with {:ok, ap} <- resolve_approval_policy(section),
         {:ok, ts} <- resolve_thread_sandbox(section),
         {:ok, tsp} <- resolve_turn_sandbox_policy(section, workspace) do
      {:ok,
       %{
         approval_policy: ap,
         thread_sandbox: ts,
         turn_sandbox_policy: tsp
       }}
    end
  end

  @impl SymphonyElixir.AgentConfig
  def validate! do
    section = codex_section()

    with {:ok, _} <- runtime_settings(section, nil) do
      if byte_size(String.trim(command(section))) > 0 do
        :ok
      else
        {:error, "Codex command missing — set codex.command in WORKFLOW.md"}
      end
    end
  end

  defp resolve_approval_policy(section) do
    case Map.get(section, "approval_policy") do
      nil ->
        {:ok, @default_approval_policy}

      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, "Invalid codex.approval_policy: #{inspect(value)}"}
          trimmed -> {:ok, trimmed}
        end

      value when is_map(value) ->
        {:ok, value}

      value ->
        {:error, "Invalid codex.approval_policy: #{inspect(value)}"}
    end
  end

  defp resolve_thread_sandbox(section) do
    case Map.get(section, "thread_sandbox") do
      nil ->
        {:ok, @default_thread_sandbox}

      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, "Invalid codex.thread_sandbox: #{inspect(value)}"}
          trimmed -> {:ok, trimmed}
        end

      value ->
        {:error, "Invalid codex.thread_sandbox: #{inspect(value)}"}
    end
  end

  defp resolve_turn_sandbox_policy(section, workspace) do
    case Map.get(section, "turn_sandbox_policy") do
      nil ->
        {:ok, default_turn_sandbox_policy(workspace)}

      value when is_map(value) ->
        {:ok, value}

      value ->
        {:error, "Invalid codex.turn_sandbox_policy: #{inspect(value)}"}
    end
  end

  defp default_turn_sandbox_policy(workspace) do
    writable_root =
      if is_binary(workspace) and String.trim(workspace) != "" do
        Path.expand(workspace)
      else
        Path.expand(SymphonyElixir.Config.workspace_root())
      end

    %{
      "type" => "workspaceWrite",
      "writableRoots" => [writable_root],
      "readOnlyAccess" => %{"type" => "fullAccess"},
      "networkAccess" => false,
      "excludeTmpdirEnvVar" => false,
      "excludeSlashTmp" => false
    }
  end

  # The process-global `codex:` section (legacy/global WORKFLOW). Per-project
  # callers pass their own resolved section explicitly so per-project
  # `codex.command`/`approval_policy`/sandbox are honored at dispatch.
  defp codex_section do
    case SymphonyElixir.Config.section("codex") do
      %{} = section -> section
      _ -> %{}
    end
  end
end
