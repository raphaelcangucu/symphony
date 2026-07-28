defmodule SymphonyElixir.AgentLifecycle.Paths do
  @moduledoc """
  Filesystem locations owned by Symphony's isolated coding-agent lifecycle.

  `:agent_data_dir` is the explicit test/operator override. The normal default
  follows XDG and never points at a provider's global home.
  """

  @agents ~w(codex claude cursor opencode)

  @spec root() :: Path.t()
  def root do
    case Application.get_env(:symphony_elixir, :agent_data_dir) do
      path when is_binary(path) and path != "" ->
        Path.expand(path)

      _ ->
        Path.join([data_home(), "symphony", "agents"])
    end
  end

  @spec agent_root(String.t()) :: Path.t()
  def agent_root(agent) when agent in @agents, do: Path.join(root(), agent)

  @spec versions_root(String.t()) :: Path.t()
  def versions_root(agent), do: Path.join(agent_root(agent), "versions")

  @spec version_root(String.t(), String.t()) :: Path.t()
  def version_root(agent, version) when is_binary(version),
    do: Path.join(versions_root(agent), safe_segment!(version))

  @spec current_manifest(String.t()) :: Path.t()
  def current_manifest(agent), do: Path.join(agent_root(agent), "current.json")

  @spec pending_manifest(String.t()) :: Path.t()
  def pending_manifest(agent), do: Path.join(agent_root(agent), "pending.json")

  @spec accounts_manifest(String.t()) :: Path.t()
  def accounts_manifest(agent), do: Path.join(agent_root(agent), "accounts.json")

  @spec account_home(String.t(), String.t()) :: Path.t()
  def account_home(agent, account_id) when is_binary(account_id) do
    Path.join([agent_root(agent), "accounts", safe_segment!(account_id), "home"])
  end

  defp data_home do
    case System.get_env("XDG_DATA_HOME") do
      value when is_binary(value) and value != "" -> Path.expand(value)
      _ -> Path.join(System.user_home!(), ".local/share")
    end
  end

  defp safe_segment!(value) do
    if Regex.match?(~r/\A[A-Za-z0-9._-]+\z/, value) do
      value
    else
      raise ArgumentError, "unsafe agent lifecycle path segment"
    end
  end
end
