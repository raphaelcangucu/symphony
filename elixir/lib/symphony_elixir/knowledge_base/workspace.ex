defmodule SymphonyElixir.KnowledgeBase.Workspace do
  @moduledoc """
  Resolves the knowledge base working directory for a repository checkout.

  Project KB edits use the repository's configured/base checkout directly. This
  keeps the project assistant, project KB, and the repository working tree aligned
  instead of staging documentation through a separate `symphony-docs` branch.
  """

  alias SymphonyElixir.KnowledgeBase.{Git, Paths}

  @type t :: %{worktree: Path.t(), docs_root: Path.t(), branch: String.t()}

  @spec docs_branch() :: String.t()
  def docs_branch, do: "symphony-docs"

  @spec ensure(Path.t(), keyword()) :: {:ok, t()} | {:error, term()}
  def ensure(checkout, opts \\ []) when is_binary(checkout) do
    with {:ok, branch} <- checkout_branch(checkout, opts) do
      docs_root = Paths.docs_root_in(checkout)
      ensure_assets_dir!(docs_root)
      {:ok, %{worktree: checkout, docs_root: docs_root, branch: branch}}
    end
  end

  defp checkout_branch(checkout, opts) do
    case Git.current_branch(checkout, opts) do
      {:ok, branch} when is_binary(branch) and branch != "" -> {:ok, branch}
      {:ok, _} -> {:ok, Keyword.get(opts, :base_branch, "HEAD")}
      error -> error
    end
  end

  defp ensure_assets_dir!(docs_root) do
    File.mkdir_p!(Path.join(docs_root, "assets"))
  end
end
