defmodule SymphonyElixir.Settings.Group do
  @moduledoc """
  Behaviour for a settings group (the role of a spatie settings class):
  declares the group key, the in-code defaults, and per-name casting.
  """

  @callback group() :: String.t()
  @callback defaults() :: %{String.t() => term()}
  @callback cast(name :: String.t(), value :: term()) :: {:ok, term()} | :error
end
