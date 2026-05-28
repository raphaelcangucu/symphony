defmodule SymphonyElixirWeb.Tracker.DevEnvController do
  @moduledoc "Propose/list/save/run dev-environment steps for a project."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.DevEnv
  alias SymphonyElixir.LocalTracker.DevEnv.Runner
  alias SymphonyElixirWeb.{DevEnvPresenter, TrackerErrors}

  @spec propose(Conn.t(), map()) :: Conn.t()
  def propose(conn, %{"project_slug" => project_slug}) do
    case DevEnv.propose_steps(project_slug) do
      {:ok, proposals} -> json(conn, %{data: Enum.map(proposals, &DevEnvPresenter.proposed/1)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug}) do
    json(conn, %{data: Enum.map(DevEnv.list_steps(project_slug), &DevEnvPresenter.step/1)})
  end

  @spec save(Conn.t(), map()) :: Conn.t()
  def save(conn, %{"project_slug" => project_slug, "steps" => steps}) when is_list(steps) do
    case DevEnv.save_steps(project_slug, steps) do
      {:ok, saved} -> json(conn, %{data: Enum.map(saved, &DevEnvPresenter.step/1)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec run(Conn.t(), map()) :: Conn.t()
  def run(conn, %{"project_slug" => project_slug}) do
    case DevEnv.start_run(project_slug) do
      {:ok, run} ->
        steps = DevEnv.list_steps(project_slug)
        Enum.each(steps, fn step -> Runner.run_step(project_slug, run, step) end)
        {:ok, finished} = DevEnv.finish_run(run)
        reloaded = DevEnv.list_runs(project_slug) |> Enum.find(&(&1.id == finished.id)) || finished
        conn |> put_status(:created) |> json(%{data: DevEnvPresenter.run(reloaded)})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  @spec run_step(Conn.t(), map()) :: Conn.t()
  def run_step(conn, %{"project_slug" => project_slug, "step_id" => step_id}) do
    with {:ok, run} <- DevEnv.start_run(project_slug),
         step when not is_nil(step) <- Enum.find(DevEnv.list_steps(project_slug), &(to_string(&1.id) == step_id)),
         {:ok, step_run} <- Runner.run_step(project_slug, run, step) do
      DevEnv.finish_run(run)
      conn |> put_status(:created) |> json(%{data: DevEnvPresenter.step_run(step_run)})
    else
      nil -> TrackerErrors.render(conn, :issue_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec runs(Conn.t(), map()) :: Conn.t()
  def runs(conn, %{"project_slug" => project_slug}) do
    json(conn, %{data: Enum.map(DevEnv.list_runs(project_slug), &DevEnvPresenter.run/1)})
  end
end
