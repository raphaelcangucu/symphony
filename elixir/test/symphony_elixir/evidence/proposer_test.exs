defmodule SymphonyElixir.Evidence.ProposerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.Proposer

  @moduletag :tmp_dir

  defp write!(path, contents) do
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, contents)
  end

  test "scans a multi-repo workspace into a per-repo evidence config", %{tmp_dir: ws} do
    # frontend: yarn + Playwright + React + a src/ dir -> UI repo
    write!(
      Path.join(ws, "frontend/package.json"),
      Jason.encode!(%{
        "scripts" => %{"test" => "jest"},
        "devDependencies" => %{"@playwright/test" => "1.0.0", "react" => "18.0.0"}
      })
    )

    File.write!(Path.join(ws, "frontend/yarn.lock"), "")
    File.mkdir_p!(Path.join(ws, "frontend/src"))

    # backend: PHP + vibe -> non-UI repo with a contract backstop toward the UI repo
    write!(Path.join(ws, "backend/composer.json"), "{}")
    File.write!(Path.join(ws, "backend/vibe"), "#!/bin/sh")

    # goapi: Go module -> non-UI repo
    write!(Path.join(ws, "goapi/go.mod"), "module x\n")

    repositories = [
      %{workspace_path: "frontend"},
      %{workspace_path: "backend"},
      %{workspace_path: "goapi"}
    ]

    assert %{required: true, repos: repos} = Proposer.propose(ws, repositories)

    assert repos["frontend"] == %{
             unit_command: "yarn test",
             ui_paths: ["src/**"],
             e2e: %{command: "npx playwright test"}
           }

    assert repos["backend"] == %{
             unit_command: "./vibe test",
             impacts: ["frontend"],
             contract_paths: ["app/Http/**", "routes/**", "graphql/**"]
           }

    assert repos["goapi"] == %{
             unit_command: "go test ./...",
             impacts: ["frontend"],
             contract_paths: ["**/*.proto", "internal/handler/**", "internal/handlers/**"]
           }
  end

  test "drops repos whose directory does not exist", %{tmp_dir: ws} do
    assert %{required: true, repos: repos} = Proposer.propose(ws, [%{workspace_path: "ghost"}])
    refute Map.has_key?(repos, "ghost")
  end

  test "a lone repo with only a Go module proposes just its unit command", %{tmp_dir: ws} do
    write!(Path.join(ws, "api/go.mod"), "module x\n")

    assert %{required: true, repos: %{"api" => config}} = Proposer.propose(ws, [%{workspace_path: "api"}])
    # No UI repo present, so no impacts/contract_paths are proposed.
    assert config == %{unit_command: "go test ./..."}
  end
end
