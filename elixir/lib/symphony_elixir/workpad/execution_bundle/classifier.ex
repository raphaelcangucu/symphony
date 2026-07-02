defmodule SymphonyElixir.Workpad.ExecutionBundle.Classifier do
  @moduledoc """
  Pure, deterministic classification of an execution-bundle unit into either
  `:workpad_task` (inline, same run) or `:child_run` (own run/worktree/PR).

  The executor never re-decides: the authoring assistant calls this and persists
  the result on the bundle. Returns `{:ambiguous, reason}` when a human must
  confirm classification.
  """

  @type unit :: %{
          optional(:repo) => String.t() | nil,
          optional(:deliverable) => String.t() | nil,
          optional(:produces) => [String.t()],
          optional(:consumes) => [String.t()],
          optional(:depends_on) => [String.t()]
        }
  @type rule ::
          :different_repo
          | :independent_deliverable
          | :shared_contract
          | :same_repo_inline
  @type result :: {:ok, :workpad_task | :child_run, rule()} | {:ambiguous, atom()}

  @spec classify(unit(), keyword()) :: result()
  def classify(unit, opts) when is_map(unit) do
    parent_repo = Keyword.get(opts, :parent_repo)
    repo = present(Map.get(unit, :repo))

    cond do
      is_nil(repo) -> {:ambiguous, :unknown_repo}
      not is_nil(parent_repo) and repo != parent_repo -> {:ok, :child_run, :different_repo}
      independent?(unit) -> {:ok, :child_run, :independent_deliverable}
      contract_coupled?(unit) -> {:ok, :child_run, :shared_contract}
      true -> {:ok, :workpad_task, :same_repo_inline}
    end
  end

  defp independent?(unit), do: present(Map.get(unit, :deliverable)) == "pr"

  defp contract_coupled?(unit) do
    list(Map.get(unit, :produces)) != [] or
      list(Map.get(unit, :consumes)) != [] or
      list(Map.get(unit, :depends_on)) != []
  end

  defp present(value) when is_binary(value), do: if(String.trim(value) == "", do: nil, else: value)
  defp present(_), do: nil

  defp list(value) when is_list(value), do: value
  defp list(_), do: []
end
