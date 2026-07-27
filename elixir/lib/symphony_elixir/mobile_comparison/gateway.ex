defmodule SymphonyElixir.MobileComparison.Gateway do
  @moduledoc """
  Boundary between comparison coordination and existing Symphony services.

  The production adapter and tests implement the same narrow contract so the
  coordinator owns ordering/idempotency without duplicating tracker or agent
  internals.
  """

  alias SymphonyElixir.MobileComparison.Contract

  @callback get_parent(String.t(), String.t(), map()) ::
              {:ok, map()} | {:error, term()}
  @callback list_children(String.t(), String.t(), map()) ::
              {:ok, [map()]} | {:error, term()}
  @callback create_child(String.t(), String.t(), Contract.cell(), String.t(), map()) ::
              {:ok, map()} | {:error, term()}
  @callback ensure_session(String.t(), map(), Contract.cell(), map()) ::
              {:ok, map()} | {:error, term()}
  @callback get_session(String.t(), map(), Contract.cell(), map()) ::
              {:ok, map()} | {:error, :not_found | term()}
  @callback start_session(map(), String.t(), map()) :: :ok | {:error, term()}
  @callback retry_session(String.t(), map(), Contract.cell(), String.t(), map()) ::
              :ok | {:error, term()}
  @callback dispatch_child(String.t(), map(), map()) :: :ok | {:error, term()}
  @callback retry_child(String.t(), map(), map()) :: :ok | {:error, term()}
  @callback list_executions(map()) :: {:ok, [map()]} | {:error, term()}
  @callback list_previews(map(), map()) :: {:ok, [map()]} | {:error, term()}
  @callback list_evidence(String.t(), String.t(), map()) ::
              {:ok, [map()]} | {:error, term()}
end
