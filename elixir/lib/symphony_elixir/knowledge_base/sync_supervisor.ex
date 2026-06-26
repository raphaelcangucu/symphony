defmodule SymphonyElixir.KnowledgeBase.SyncSupervisor do
  @moduledoc "DynamicSupervisor for per-repo knowledge base sync workers."

  use DynamicSupervisor

  alias SymphonyElixir.KnowledgeBase.SyncWorker

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts), do: DynamicSupervisor.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(_opts), do: DynamicSupervisor.init(strategy: :one_for_one)

  @spec ensure_worker(String.t(), String.t(), keyword()) :: {:ok, pid()} | {:error, term()}
  def ensure_worker(project_slug, repo_slug, opts \\ []) do
    spec = {SyncWorker, Keyword.merge([project_slug: project_slug, repo_slug: repo_slug], opts)}

    case DynamicSupervisor.start_child(__MODULE__, spec) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      error -> error
    end
  end
end
