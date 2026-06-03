defmodule SymphonyElixir.EditorSupervisor do
  @moduledoc """
  Editor subtree: the `code-server` manager (`Editor.Server`), present only when
  `Config.editor_enabled?/0`. The managed `code-server` is an external process
  that `Editor.Server` reuses across restarts, so restarting this subtree (or a
  full restart) never drops a live editor session.
  """

  use Supervisor

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Supervisor.init(child_specs(editor_enabled?()), strategy: :one_for_one)
  end

  @spec child_specs(boolean()) :: [module()]
  def child_specs(true), do: [SymphonyElixir.Editor.Server]
  def child_specs(false), do: []

  @spec child_specs() :: [module()]
  def child_specs, do: child_specs(editor_enabled?())

  defp editor_enabled? do
    SymphonyElixir.Config.editor_enabled?()
  rescue
    _ -> false
  end
end
