defmodule SymphonyElixir.AgentLifecycle.Catalog do
  @moduledoc """
  Static provider facts used by installation, probing, and launch projection.

  Values mirror the working Jean sources: Anthropic's signed distribution
  manifest for Claude, GitHub release assets for Codex/OpenCode, and Cursor's
  official isolated installer.
  """

  @catalog %{
    "codex" => %{
      kind: "codex",
      executable: "codex",
      executable_candidates: ["codex"],
      version_args: ["--version"],
      account_home_env: "CODEX_HOME",
      launch_args: ["--config", "shell_environment_policy.inherit=all", "app-server"],
      release: %{type: :github, repo: "openai/codex", api: "https://api.github.com/repos/openai/codex/releases"}
    },
    "claude" => %{
      kind: "claude",
      executable: "claude",
      executable_candidates: ["claude"],
      version_args: ["--version"],
      account_home_env: "CLAUDE_CONFIG_DIR",
      release: %{
        type: :anthropic,
        base_url: "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096ae3/claude-code-releases"
      }
    },
    "cursor" => %{
      kind: "cursor",
      executable: "cursor-agent",
      executable_candidates: ["cursor-agent", "agent"],
      version_args: ["--version"],
      account_home_env: "CURSOR_AGENT_HOME",
      release: %{type: :installer, url: "https://cursor.com/install"}
    },
    "opencode" => %{
      kind: "opencode",
      executable: "opencode",
      executable_candidates: ["opencode"],
      version_args: ["--version"],
      account_home_env: "OPENCODE_CONFIG_DIR",
      release: %{
        type: :github,
        repo: "anomalyco/opencode",
        api: "https://api.github.com/repos/anomalyco/opencode/releases"
      }
    }
  }

  @spec kinds() :: [String.t()]
  def kinds, do: ~w(codex claude cursor opencode)

  @spec fetch(String.t()) :: {:ok, map()} | :error
  def fetch(kind) when is_binary(kind), do: Map.fetch(@catalog, kind)
  def fetch(_kind), do: :error

  @spec fetch!(String.t()) :: map()
  def fetch!(kind), do: Map.fetch!(@catalog, kind)

  @spec launch_command(String.t(), Path.t()) :: String.t()
  def launch_command(kind, executable_path) when is_binary(executable_path) do
    entry = fetch!(kind)
    Enum.join([executable_path | Map.get(entry, :launch_args, [])], " ")
  end
end
