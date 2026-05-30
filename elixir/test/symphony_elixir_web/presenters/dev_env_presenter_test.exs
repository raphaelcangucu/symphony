defmodule SymphonyElixirWeb.DevEnvPresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.{ProposedStep, Step}
  alias SymphonyElixirWeb.DevEnvPresenter

  test "step/1 includes serve fields" do
    step = %Step{
      id: 1,
      description: "d",
      command: "npm run dev",
      role: "serve",
      port_env: "PORT",
      url_path: "/",
      ready_probe: "http",
      ready_path: "/",
      primary: true,
      source: "manual",
      optional: false,
      position: 0
    }

    dto = DevEnvPresenter.step(step)

    assert dto.role == "serve"
    assert dto.port_env == "PORT"
    assert dto.url_path == "/"
    assert dto.ready_probe == "http"
    assert dto.ready_path == "/"
    assert dto.primary == true
  end

  test "proposed/1 includes serve fields" do
    p = ProposedStep.new(%{description: "d", command: "c", source: "heuristic", role: "serve", primary: true})

    dto = DevEnvPresenter.proposed(p)

    assert dto.role == "serve"
    assert dto.primary == true
  end
end
