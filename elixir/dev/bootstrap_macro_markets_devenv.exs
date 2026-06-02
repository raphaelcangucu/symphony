# One-time bootstrap: save DevEnv serve steps for macro-markets from convention/heuristics.
#
# Usage (after `make serve WORKFLOW=./WORKFLOW.macro-markets.md` is running):
#   cd elixir && mise exec -- mix run dev/bootstrap_macro_markets_devenv.exs
#
# Or run while serve is down (loads workflow + repo only):
#   cd elixir && mise exec -- mix run --no-start dev/bootstrap_macro_markets_devenv.exs

defmodule Symphony.BootstrapMacroMarketsDevenv do
  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.Repo

  @project_slug "macro-markets"

  def run do
    workflow = Path.expand("WORKFLOW.macro-markets.md")
    SymphonyElixir.Workflow.set_workflow_file_path(workflow)

    unless File.regular?(workflow) do
      fail("Workflow not found: #{workflow}")
    end

    start_repo!()

    case Context.get_project(@project_slug) do
      {:ok, _project} -> :ok
      {:error, :project_not_found} -> fail("Project #{@project_slug} not found in local tracker DB")
    end

    case DevEnv.propose_steps(@project_slug) do
      {:ok, proposed} when proposed != [] ->
        attrs =
          Enum.map(proposed, fn step ->
            step
            |> Map.from_struct()
            |> Map.drop([:__struct__])
          end)

        case DevEnv.save_steps(@project_slug, attrs) do
          {:ok, saved} ->
            IO.puts("Saved #{length(saved)} DevEnv steps for #{@project_slug}:")
            Enum.each(saved, fn s ->
              IO.puts("  [#{s.role}] #{s.description} | #{s.command} | wd=#{inspect(s.working_dir)} primary=#{s.primary}")
            end)

          {:error, reason} ->
            fail("Failed to save steps: #{inspect(reason)}")
        end

      {:ok, []} ->
        fail("No steps proposed — add .symphony/devenv.yaml to a workspace repo or check repositories config")

      {:error, reason} ->
        fail("propose_steps failed: #{inspect(reason)}")
    end
  end

  defp start_repo! do
    Application.load(:symphony_elixir)
    {:ok, _} = Application.ensure_all_started(:logger)
    {:ok, _} = Application.ensure_all_started(:ssl)
    {:ok, _} = Application.ensure_all_started(:exqlite)
    {:ok, _} = Repo.start_link()
    Ecto.Migrator.run(Repo, :up, all: true)
  end

  defp fail(message) do
    IO.puts(:stderr, message)
    System.halt(1)
  end
end

Symphony.BootstrapMacroMarketsDevenv.run()
