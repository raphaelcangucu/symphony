import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevEnvPanel } from "@/components/devenv/DevEnvPanel";
import * as devEnv from "@/services/devEnv";
import type { DevEnvStep } from "@/types/devEnv";
import type { WorkspaceRepository } from "@/types/repository";

vi.mock("@/services/devEnv");

function step(overrides: Partial<DevEnvStep> = {}): DevEnvStep {
  return {
    description: "",
    command: "",
    workingDir: null,
    source: "manual",
    optional: false,
    role: "setup",
    primary: false,
    portEnv: null,
    urlPath: "/",
    readyProbe: "tcp",
    readyPath: "/",
    ...overrides,
  };
}

const repositories: WorkspaceRepository[] = [
  { fullName: "acme/frontend", workspacePath: "frontend", role: "primary" },
  { fullName: "acme/backend", workspacePath: "backend", role: "backend" },
];

function Harness({ initial = [] as DevEnvStep[] }) {
  const [steps, setSteps] = useState<DevEnvStep[]>(initial);
  return (
    <>
      <DevEnvPanel projectSlug="p" repositories={repositories} steps={steps} onStepsChange={setSteps} />
      <output data-testid="working-dirs">{steps.map((s) => s.workingDir ?? "null").join(",")}</output>
    </>
  );
}

describe("DevEnvPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("groups steps under their repository", () => {
    render(
      <Harness
        initial={[
          step({ id: "1", description: "Backend serve", command: "sail up", workingDir: "backend", role: "serve" }),
          step({ id: "2", description: "Frontend install", command: "yarn install", workingDir: "frontend" }),
        ]}
      />,
    );

    const frontendGroup = screen.getByText("acme/frontend").closest("div")!.parentElement as HTMLElement;
    const backendGroup = screen.getByText("acme/backend").closest("div")!.parentElement as HTMLElement;
    expect(within(frontendGroup).getByDisplayValue("yarn install")).toBeInTheDocument();
    expect(within(backendGroup).getByDisplayValue("sail up")).toBeInTheDocument();
  });

  it("adds a step to the repository group that requested it", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "Add step to acme/backend" }));

    expect(screen.getByTestId("working-dirs")).toHaveTextContent("backend");
  });

  it("appends proposed steps", async () => {
    vi.mocked(devEnv.proposeDevEnvSteps).mockResolvedValue([
      step({ description: "Install", command: "mix deps.get", workingDir: "frontend", source: "heuristic" }),
    ]);

    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: /propose steps/i }));

    await waitFor(() => expect(screen.getByDisplayValue("mix deps.get")).toBeInTheDocument());
  });
});
