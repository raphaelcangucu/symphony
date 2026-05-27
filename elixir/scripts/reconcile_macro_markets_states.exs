#!/usr/bin/env mix run
# Reconciles Symphony State options on Macro Markets with WORKFLOW.macromarkets.example.md.
#
# Usage (from elixir/, with WORKFLOW.md copied from the example or equivalent tracker):
#   export GITHUB_TOKEN="$(gh auth token)"
#   cp WORKFLOW.macromarkets.example.md WORKFLOW.md
#   mise exec -- mix run --no-start scripts/reconcile_macro_markets_states.exs

{:ok, _} = Application.ensure_all_started(:req)

alias SymphonyElixir.GitHub.{ProjectMetadata, StateReconciliation}

base_dir = File.cwd!()

with {:ok, metadata} <- ProjectMetadata.read(base_dir),
     :ok <- StateReconciliation.reconcile(base_dir, metadata) do
  {:ok, refreshed} = ProjectMetadata.read(base_dir)
  IO.puts(Jason.encode!(refreshed["state_options"], pretty: true))
  IO.puts(:stderr, "Reconciled Symphony State on #{metadata["project_url"]}")
else
  {:error, :enoent} ->
    IO.puts(:stderr, "Missing .symphony/github-project.json — run bootstrap_macro_markets.exs first")
    System.halt(1)

  {:error, reason} ->
    IO.puts(:stderr, "Reconcile failed: #{inspect(reason)}")
    System.halt(1)
end
