defmodule SymphonyElixir.AgentLifecycle.E2EInstaller do
  @moduledoc false

  alias SymphonyElixir.AgentLifecycle.Installer

  def install_latest(agent, _options) do
    base_url = System.fetch_env!("SYMPHONY_AGENT_E2E_FIXTURE_URL")

    with {:ok, %Req.Response{status: 200, body: body}} <-
           Req.get("#{base_url}/manifest/#{agent}") do
      Installer.install(agent, %{
        version: body["version"],
        url: body["url"],
        checksum: body["checksum"],
        format: format(body["format"])
      })
    else
      {:ok, %Req.Response{status: status}} -> {:error, {:fixture_status, status}}
      {:error, reason} -> {:error, {:fixture_request, reason}}
    end
  end

  defp format("zip"), do: :zip
  defp format(_format), do: :raw
end
