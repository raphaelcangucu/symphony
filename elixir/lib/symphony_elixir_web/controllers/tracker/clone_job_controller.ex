defmodule SymphonyElixirWeb.Tracker.CloneJobController do
  @moduledoc "Lists and retries clone jobs for a project."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.{CloneSupervisor, Templates}
  alias SymphonyElixirWeb.TemplatePresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug}) do
    jobs = Templates.list_clone_jobs(project_slug)
    json(conn, %{data: Enum.map(jobs, &TemplatePresenter.clone_job/1)})
  end

  @spec retry(Conn.t(), map()) :: Conn.t()
  def retry(conn, %{"project_slug" => _project_slug, "id" => job_id}) do
    {:ok, _pid} = CloneSupervisor.start_job(String.to_integer(job_id))
    send_resp(conn, :accepted, "")
  end
end
