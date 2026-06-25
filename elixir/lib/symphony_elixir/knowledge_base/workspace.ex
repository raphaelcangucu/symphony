defmodule SymphonyElixir.KnowledgeBase.Workspace do
  @moduledoc """
  Resolves the knowledge base working directory for a repository checkout.

  KB edits live on a dedicated `symphony-docs` branch, materialized as a git
  worktree at `<checkout>/.worktrees/symphony-docs`. Both reads and writes use
  this directory so the UI always sees the same content it commits.
  """

  alias SymphonyElixir.KnowledgeBase.{Git, Paths}

  @docs_branch "symphony-docs"

  @type t :: %{worktree: Path.t(), docs_root: Path.t(), branch: String.t()}

  @spec docs_branch() :: String.t()
  def docs_branch, do: @docs_branch

  @spec ensure(Path.t(), keyword()) :: {:ok, t()} | {:error, term()}
  def ensure(checkout, opts \\ []) when is_binary(checkout) do
    with {:ok, worktree} <- Git.ensure_worktree(checkout, @docs_branch, opts) do
      {:ok, %{worktree: worktree, docs_root: Paths.docs_root_in(worktree), branch: @docs_branch}}
    end
  end
end
