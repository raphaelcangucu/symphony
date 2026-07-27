defmodule SymphonyElixir.MobileRpc.Methods.Comparisons do
  @moduledoc "Allowlisted Dev10x comparison lifecycle over encrypted mobile RPC."

  alias SymphonyElixir.MobileComparison.{Contract, Subscription}
  alias SymphonyElixir.MobileRpc.{ComparisonService, MobileMethod}

  @spec modules() :: [module()]
  def modules do
    [__MODULE__.Start, __MODULE__.Get, __MODULE__.Subscribe, __MODULE__.RetryCell]
  end

  defmodule Start do
    use MobileMethod,
      name: "comparisons.start",
      allowed_keys: ~w(project_slug identifier request_key),
      required_keys: ~w(project_slug identifier request_key),
      timeout_ms: 30_000,
      service: ComparisonService,
      service_key: :mobile_comparison_service
  end

  defmodule Get do
    use MobileMethod,
      name: "comparisons.get",
      allowed_keys: ~w(project_slug identifier),
      required_keys: ~w(project_slug identifier),
      timeout_ms: 10_000,
      service: ComparisonService,
      service_key: :mobile_comparison_service
  end

  defmodule RetryCell do
    @behaviour SymphonyElixir.MobileRpc.Method

    @impl true
    def name, do: "comparisons.retry_cell"

    @impl true
    def scope, do: :mobile

    @impl true
    def timeout_ms, do: 30_000

    @impl true
    def validate(params) do
      with {:ok, validated} <-
             MobileMethod.validate_params(
               params,
               ~w(project_slug identifier request_key cell_id),
               ~w(project_slug identifier request_key cell_id)
             ),
           {:ok, _cell} <- Contract.fetch(validated["cell_id"]) do
        {:ok, validated}
      else
        _reason -> {:error, :invalid_params}
      end
    end

    @impl true
    def call(params, context) do
      context
      |> Map.get(:mobile_comparison_service, ComparisonService)
      |> apply(:call, [name(), params, context])
    end
  end

  defmodule Subscribe do
    @behaviour SymphonyElixir.MobileRpc.Method

    @impl true
    def name, do: "comparisons.subscribe"

    @impl true
    def scope, do: :mobile

    @impl true
    def timeout_ms, do: 10_000

    @impl true
    def validate(params) do
      MobileMethod.validate_params(
        params,
        ~w(project_slug identifier),
        ~w(project_slug identifier)
      )
    end

    @impl true
    def call(%{"identifier" => identifier} = params, context) do
      subscription_id = unique_id(identifier)
      subscription = Map.get(context, :comparison_subscription, Subscription)
      connection_pid = Map.get(context, :connection_pid)
      subscription_context = Map.put(context, :comparison_subscription_id, subscription_id)

      with true <- is_pid(connection_pid),
           {:ok, pid} <- subscription.subscribe(connection_pid, params, subscription_context) do
        cleanup = fn -> subscription.stop(pid) end
        activate = fn -> subscription.activate(pid) end

        {:ok, {:subscription, subscription_id, %{"subscription_id" => subscription_id}, cleanup, activate}}
      else
        _reason -> {:error, :comparison_subscription_failed}
      end
    end

    defp unique_id(identifier) do
      "comparison:#{identifier}:" <>
        Integer.to_string(System.unique_integer([:positive, :monotonic]))
    end
  end
end
