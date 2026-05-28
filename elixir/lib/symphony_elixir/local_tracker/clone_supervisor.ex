defmodule SymphonyElixir.LocalTracker.CloneSupervisor do
  @moduledoc "Spawns one CloneWorker per clone job."

  use DynamicSupervisor

  alias SymphonyElixir.LocalTracker.CloneWorker

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts) do
    DynamicSupervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts), do: DynamicSupervisor.init(strategy: :one_for_one)

  @spec start_job(integer()) :: DynamicSupervisor.on_start_child()
  def start_job(job_id) do
    DynamicSupervisor.start_child(__MODULE__, {CloneWorker, [job_id: job_id]})
  end
end
