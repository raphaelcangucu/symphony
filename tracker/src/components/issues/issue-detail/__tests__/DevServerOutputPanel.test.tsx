import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchDevServerOutput, subscribeDevServerOutput } from "@/services/issueDevServers";

import { DevServerOutputPanel } from "../DevServerOutputPanel";

vi.mock("@/services/issueDevServers", () => ({
  fetchDevServerOutput: vi.fn(),
  subscribeDevServerOutput: vi.fn(),
}));

describe("DevServerOutputPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(subscribeDevServerOutput).mockReturnValue(() => undefined);
  });

  it("shows load error without empty pre body", async () => {
    vi.mocked(fetchDevServerOutput).mockRejectedValue(new Error("fail"));

    render(
      <DevServerOutputPanel
        projectSlug="macro-markets"
        issueIdentifier="510"
        serverId={1}
        slug="front"
        status="crashed"
        sessionName="sym"
        defaultOpen
      />,
    );

    expect(await screen.findByText(/could not load server output/i)).toBeInTheDocument();
    expect(screen.queryByText(/no output captured/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/front command output/i)).not.toBeInTheDocument();
  });
});
