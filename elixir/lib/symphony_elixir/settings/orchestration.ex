defmodule SymphonyElixir.Settings.Orchestration do
  @moduledoc """
  Operator settings that gate what the orchestrator is allowed to auto-start
  (group "orchestrator").

  - `require_symphony_label`: only auto-dispatch issues carrying a `symphony`,
    `symphony:codex`, or `symphony:claude` label. Manual UI dispatch is never
    gated by this flag.
  - `require_assignee_match`: only auto-dispatch issues assigned to the
    connected provider identity (GitHub viewer login / Jira accountId / Linear
    user id). When off, assignee is ignored during candidate selection.
  - `agent_token_budget_enabled`: when true, force-stop runs whose cumulative
    agent tokens exceed `agent_token_budget`. Defaults to `false`.
  - `agent_token_budget`: token ceiling used when the guard is enabled. Defaults
    to 4_000_000.
  - `agent_token_hard_ceiling`: an always-on runaway backstop applied even when
    the configurable guard above is disabled. A non-goal run with no stop signal
    can otherwise spin for its whole turn budget and burn tens of millions of
    tokens; this ceiling force-stops it. Defaults to 15_000_000; `0` disables the
    backstop entirely (truly unbounded). The operator `agent_token_budget` still
    takes precedence when the guard is enabled.

  Both gating flags default to `true` so a fresh instance is conservative: the
  orchestrator never picks up unlabeled or unassigned work without an explicit
  opt-out.
  """

  @behaviour SymphonyElixir.Settings.Group

  alias SymphonyElixir.Settings

  @group "orchestrator"
  @require_symphony_label "require_symphony_label"
  @require_assignee_match "require_assignee_match"
  @agent_token_budget_enabled "agent_token_budget_enabled"
  @agent_token_budget "agent_token_budget"
  @agent_token_hard_ceiling "agent_token_hard_ceiling"
  @default_agent_token_budget 4_000_000
  @default_agent_token_hard_ceiling 15_000_000

  @impl true
  def group, do: @group

  @impl true
  def defaults do
    %{
      @require_symphony_label => true,
      @require_assignee_match => true,
      @agent_token_budget_enabled => false,
      @agent_token_budget => @default_agent_token_budget,
      @agent_token_hard_ceiling => @default_agent_token_hard_ceiling
    }
  end

  @impl true
  def cast(name, value)
      when name in [@require_symphony_label, @require_assignee_match, @agent_token_budget_enabled] do
    case normalize_boolean(value) do
      {:ok, boolean} -> {:ok, boolean}
      :error -> :error
    end
  end

  def cast(@agent_token_budget, value) do
    case normalize_positive_integer(value) do
      {:ok, budget} when budget >= 1 -> {:ok, budget}
      _ -> :error
    end
  end

  def cast(@agent_token_hard_ceiling, value) do
    normalize_non_negative_integer(value)
  end

  def cast(_name, _value), do: :error

  @doc "Whether the orchestrator should only auto-start issues with a symphony label."
  @spec require_symphony_label?() :: boolean()
  def require_symphony_label?, do: boolean_setting(@require_symphony_label)

  @doc "Whether the orchestrator should only auto-start issues assigned to the connected identity."
  @spec require_assignee_match?() :: boolean()
  def require_assignee_match?, do: boolean_setting(@require_assignee_match)

  @doc "Whether the per-run cumulative token budget guard is active."
  @spec agent_token_budget_enabled?() :: boolean()
  def agent_token_budget_enabled?, do: boolean_setting(@agent_token_budget_enabled)

  @doc """
  Effective token budget for a single run. Returns `0` when the guard is disabled.
  """
  @spec agent_token_budget() :: non_neg_integer()
  def agent_token_budget do
    if agent_token_budget_enabled?(), do: configured_agent_token_budget(), else: 0
  end

  @doc "Configured ceiling when the guard is enabled."
  @spec configured_agent_token_budget() :: pos_integer()
  def configured_agent_token_budget, do: integer_setting(@agent_token_budget)

  @doc """
  Always-on runaway backstop token ceiling. `0` means the backstop is disabled.
  """
  @spec agent_token_hard_ceiling() :: non_neg_integer()
  def agent_token_hard_ceiling, do: non_negative_integer_setting(@agent_token_hard_ceiling)

  defp boolean_setting(name) do
    case Settings.get(@group, name) do
      value when is_boolean(value) -> value
      _ -> Map.fetch!(defaults(), name)
    end
  end

  defp integer_setting(name) do
    case Settings.get(@group, name) do
      value when is_integer(value) and value >= 1 -> value
      _ -> Map.fetch!(defaults(), name)
    end
  end

  defp non_negative_integer_setting(name) do
    case Settings.get(@group, name) do
      value when is_integer(value) and value >= 0 -> value
      _ -> Map.fetch!(defaults(), name)
    end
  end

  defp normalize_boolean(value) when is_boolean(value), do: {:ok, value}
  defp normalize_boolean("true"), do: {:ok, true}
  defp normalize_boolean("false"), do: {:ok, false}
  defp normalize_boolean(_value), do: :error

  defp normalize_positive_integer(value) when is_integer(value) and value >= 1, do: {:ok, value}

  defp normalize_positive_integer(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed >= 1 -> {:ok, parsed}
      _ -> :error
    end
  end

  defp normalize_positive_integer(_value), do: :error

  defp normalize_non_negative_integer(value) when is_integer(value) and value >= 0, do: {:ok, value}

  defp normalize_non_negative_integer(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed >= 0 -> {:ok, parsed}
      _ -> :error
    end
  end

  defp normalize_non_negative_integer(_value), do: :error
end
