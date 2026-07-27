defmodule SymphonyElixir.MobileRpc.Methods.Evidence do
  @moduledoc "Durable issue evidence operations over encrypted mobile RPC."

  @spec modules() :: [module()]
  def modules, do: [__MODULE__.List, __MODULE__.ArtifactRead]

  defmodule List do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "evidence.list",
      service: SymphonyElixir.MobileRpc.EvidenceService,
      service_key: :mobile_evidence_service,
      allowed_keys: ["project_slug", "identifier"],
      required_keys: ["project_slug", "identifier"],
      timeout_ms: 10_000
  end

  defmodule ArtifactRead do
    @behaviour SymphonyElixir.MobileRpc.Method

    @max_chunk_bytes 512 * 1024
    @keys ~w(project_slug identifier run_id path offset length)

    @impl true
    def name, do: "evidence.artifact.read"

    @impl true
    def scope, do: :mobile

    @impl true
    def timeout_ms, do: 10_000

    @impl true
    def validate(
          %{
            "project_slug" => project_slug,
            "identifier" => identifier,
            "run_id" => run_id,
            "path" => path,
            "offset" => offset,
            "length" => length
          } = params
        )
        when is_binary(project_slug) and byte_size(project_slug) > 0 and
               is_binary(identifier) and byte_size(identifier) > 0 and
               is_binary(run_id) and byte_size(run_id) > 0 and
               is_binary(path) and byte_size(path) > 0 and
               is_integer(offset) and offset >= 0 and
               is_integer(length) and length >= 1 and length <= @max_chunk_bytes do
      if Enum.sort(Map.keys(params)) == Enum.sort(@keys) do
        {:ok, params}
      else
        {:error, :invalid_params}
      end
    end

    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(params, context) do
      context
      |> Map.get(:mobile_evidence_service, SymphonyElixir.MobileRpc.EvidenceService)
      |> apply(:call, [name(), params, context])
    end
  end
end
