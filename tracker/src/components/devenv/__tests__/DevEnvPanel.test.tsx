import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevEnvPanel } from "@/components/devenv/DevEnvPanel";
import * as devEnv from "@/services/devEnv";

vi.mock("@/services/devEnv");

describe("DevEnvPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads saved steps then proposes and saves", async () => {
    vi.mocked(devEnv.listDevEnvSteps).mockResolvedValue([]);
    vi.mocked(devEnv.proposeDevEnvSteps).mockResolvedValue([
      { description: "Install", command: "mix deps.get", workingDir: "api", source: "heuristic", optional: false },
    ]);
    vi.mocked(devEnv.saveDevEnvSteps).mockResolvedValue([
      { id: "1", description: "Install", command: "mix deps.get", workingDir: "api", source: "manual", optional: false, position: 0 },
    ]);

    render(<DevEnvPanel projectSlug="p" />);

    await waitFor(() => expect(devEnv.listDevEnvSteps).toHaveBeenCalledWith("p"));
    await userEvent.click(screen.getByRole("button", { name: /propose steps/i }));
    await waitFor(() => expect(screen.getByDisplayValue("mix deps.get")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /save steps/i }));
    await waitFor(() => expect(devEnv.saveDevEnvSteps).toHaveBeenCalled());
  });
});
