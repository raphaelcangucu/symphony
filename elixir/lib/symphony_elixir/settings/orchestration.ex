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

  Both default to `true` so a fresh instance is conservative: the orchestrator
  never picks up unlabeled or unassigned work without an explicit opt-out.
  """

  @behaviour SymphonyElixir.Settings.Group

  alias SymphonyElixir.Settings

  @group "orchestrator"
  @require_symphony_label "require_symphony_label"
  @require_assignee_match "require_assignee_match"

  @impl true
  def group, do: @group

  @impl true
  def defaults do
    %{
      @require_symphony_label => true,
      @require_assignee_match => true
    }
  end

  @impl true
  def cast(name, value)
      when name in [@require_symphony_label, @require_assignee_match] do
    case normalize_boolean(value) do
      {:ok, boolean} -> {:ok, boolean}
      :error -> :error
    end
  end

  def cast(_name, _value), do: :error

  @doc "Whether the orchestrator should only auto-start issues with a symphony label."
  @spec require_symphony_label?() :: boolean()
  def require_symphony_label?, do: boolean_setting(@require_symphony_label)

  @doc "Whether the orchestrator should only auto-start issues assigned to the connected identity."
  @spec require_assignee_match?() :: boolean()
  def require_assignee_match?, do: boolean_setting(@require_assignee_match)

  defp boolean_setting(name) do
    case Settings.get(@group, name) do
      value when is_boolean(value) -> value
      _ -> Map.fetch!(defaults(), name)
    end
  end

  defp normalize_boolean(value) when is_boolean(value), do: {:ok, value}
  defp normalize_boolean("true"), do: {:ok, true}
  defp normalize_boolean("false"), do: {:ok, false}
  defp normalize_boolean(_value), do: :error
end
