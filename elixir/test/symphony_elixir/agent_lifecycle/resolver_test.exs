defmodule SymphonyElixir.AgentLifecycle.ResolverTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentLifecycle.Resolver
  alias SymphonyElixir.AgentLifecycle.Resolver.Result

  test "falls back from the preferred managed install to PATH" do
    assert {:ok,
            %Result{
              preferred_source: :managed,
              effective_source: :path,
              executable_path: "/fixture/path/codex",
              version: "codex 2.0.0",
              fallback_reason: :managed_missing,
              probed_at: 1_900_000_000
            }} =
             Resolver.resolve("codex",
               preferred_source: :managed,
               managed_probe: fn -> {:error, :managed_missing} end,
               path_probe: fn -> {:ok, %{path: "/fixture/path/codex", version: "codex 2.0.0"}} end,
               now: fn -> 1_900_000_000 end
             )
  end

  test "reports both failures when neither source is usable" do
    assert {:error,
            %{
              preferred_source: :managed,
              managed: :managed_missing,
              path: :not_found
            }} =
             Resolver.resolve("codex",
               preferred_source: :managed,
               managed_probe: fn -> {:error, :managed_missing} end,
               path_probe: fn -> {:error, :not_found} end
             )
  end

  test "automatically recovers to managed when it becomes healthy again" do
    state = start_supervised!({Agent, fn -> :missing end})

    managed_probe = fn ->
      case Agent.get(state, & &1) do
        :missing -> {:error, :managed_missing}
        :ready -> {:ok, %{path: "/managed/codex", version: "codex 3.0.0"}}
      end
    end

    options = [
      preferred_source: :managed,
      managed_probe: managed_probe,
      path_probe: fn -> {:ok, %{path: "/path/codex", version: "codex 2.0.0"}} end
    ]

    assert {:ok, %Result{effective_source: :path, fallback_reason: :managed_missing}} =
             Resolver.resolve("codex", options)

    Agent.update(state, fn _ -> :ready end)

    assert {:ok, %Result{effective_source: :managed, fallback_reason: nil}} =
             Resolver.resolve("codex", options)
  end
end
