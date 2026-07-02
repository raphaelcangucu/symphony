import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectTelegramIntegrationCard } from "@/components/projects/ProjectTelegramIntegrationCard";
import {
  createProjectTelegramPairingCode,
  getProjectTelegramGateway,
  resetProjectTelegramSession,
  unpairProjectTelegram,
} from "@/services/gateways";

vi.mock("@/services/gateways", () => ({
  getProjectTelegramGateway: vi.fn(),
  createProjectTelegramPairingCode: vi.fn(),
  resetProjectTelegramSession: vi.fn(),
  unpairProjectTelegram: vi.fn(),
}));

describe("ProjectTelegramIntegrationCard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getProjectTelegramGateway).mockResolvedValue({
      globalConfigured: true,
      binding: {
        id: 1,
        projectSlug: "macro-markets",
        conversationId: "-100123:topic:42",
        threadId: "42",
        status: "active",
        defaultAgentKind: "codex",
        defaultMode: "explore",
        activeMode: "explore",
        activeThreadId: null,
      },
    });
  });

  it("loads the current project topic binding", async () => {
    render(<ProjectTelegramIntegrationCard projectSlug="macro-markets" />);

    expect(await screen.findByText("Telegram")).toBeTruthy();
    expect(await screen.findByText("Topic 42")).toBeTruthy();
  });

  it("generates a project pairing command", async () => {
    vi.mocked(createProjectTelegramPairingCode).mockResolvedValue({ code: "PAIR1", command: "/symphony_pair PAIR1" });

    render(<ProjectTelegramIntegrationCard projectSlug="macro-markets" />);

    fireEvent.click(await screen.findByText("Generate project pairing code"));
    expect(await screen.findByText("/symphony_pair PAIR1")).toBeTruthy();
  });

  it("resets and unpairs with confirmation actions", async () => {
    vi.mocked(resetProjectTelegramSession).mockResolvedValue({ globalConfigured: true, binding: null });
    vi.mocked(unpairProjectTelegram).mockResolvedValue({ globalConfigured: true, binding: null });

    render(<ProjectTelegramIntegrationCard projectSlug="macro-markets" />);

    fireEvent.click(await screen.findByText("Reset topic session"));
    expect(resetProjectTelegramSession).toHaveBeenCalledWith("macro-markets");

    fireEvent.click(screen.getByText("Unpair topic"));
    expect(unpairProjectTelegram).toHaveBeenCalledWith("macro-markets");
  });
});
