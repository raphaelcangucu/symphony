defmodule SymphonyElixir.LocalTracker.Config do
  @moduledoc """
  Local tracker configuration read from the `local:` YAML section.
  """

  @behaviour SymphonyElixir.TrackerConfig

  @impl SymphonyElixir.TrackerConfig
  def validate! do
    if is_binary(SymphonyElixir.Config.local_project_slug()) do
      :ok
    else
      {:error, "Local tracker project slug missing — set local.project_slug in WORKFLOW.md"}
    end
  end
end
