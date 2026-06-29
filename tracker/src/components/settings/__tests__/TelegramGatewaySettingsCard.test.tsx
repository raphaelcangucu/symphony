import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TelegramGatewaySettingsCard } from "@/components/settings/TelegramGatewaySettingsCard";
import { createTelegramGroupPairingCode, getGatewaySettings, updateTelegramGatewaySettings } from "@/services/gateways";
import { updateCredential } from "@/services/settings";

vi.mock("@/services/gateways", () => ({
  getGatewaySettings: vi.fn(),
  updateTelegramGatewaySettings: vi.fn(),
  createTelegramGroupPairingCode: vi.fn(),
}));

vi.mock("@/services/settings", () => ({
  updateCredential: vi.fn(),
}));

describe("TelegramGatewaySettingsCard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getGatewaySettings).mockResolvedValue({
      telegram: {
        enabled: false,
        botUsername: "sym_bot",
        botTokenConfigured: true,
        groupChatId: "-100123",
        allowedUserIds: ["777"],
        dmPolicy: "allowlist",
        dmAllowedUserIds: ["777"],
        requireMention: true,
        pollingEnabled: false,
      },
    });
  });

  it("loads telegram settings and saves edits", async () => {
    vi.mocked(updateTelegramGatewaySettings).mockResolvedValue({
      telegram: {
        enabled: true,
        botUsername: "sym_bot",
        botTokenConfigured: true,
        groupChatId: "-100123",
        allowedUserIds: ["777"],
        dmPolicy: "allowlist",
        dmAllowedUserIds: ["777"],
        requireMention: true,
        pollingEnabled: true,
      },
    });

    render(<TelegramGatewaySettingsCard />);

    expect(await screen.findByText("Telegram")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Enable Telegram gateway"));
    fireEvent.click(screen.getByText("Save Telegram settings"));

    await waitFor(() => expect(updateTelegramGatewaySettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: true })));
  });

  it("generates a group pairing command", async () => {
    vi.mocked(createTelegramGroupPairingCode).mockResolvedValue({ code: "ABC123", command: "/symphony_setup ABC123" });

    render(<TelegramGatewaySettingsCard />);

    fireEvent.click(await screen.findByText("Generate group pairing code"));

    expect(await screen.findByText("/symphony_setup ABC123")).toBeTruthy();
  });

  it("saves the Telegram Bot API token as an encrypted credential", async () => {
    vi.mocked(updateCredential).mockResolvedValue({
      provider: "telegram",
      label: "Telegram",
      fields: [{ key: "bot_token", label: "Bot token", secret: true, configured: true, source: "db" }],
    });

    render(<TelegramGatewaySettingsCard />);

    fireEvent.change(await screen.findByLabelText("Telegram Bot API token"), { target: { value: "123:abc" } });
    fireEvent.click(screen.getByText("Save Bot API token"));

    await waitFor(() => expect(updateCredential).toHaveBeenCalledWith("telegram", "bot_token", "123:abc"));
  });

  it("also saves a filled token when saving Telegram settings", async () => {
    vi.mocked(updateCredential).mockResolvedValue({
      provider: "telegram",
      label: "Telegram",
      fields: [{ key: "bot_token", label: "Bot token", secret: true, configured: true, source: "db" }],
    });
    vi.mocked(updateTelegramGatewaySettings).mockResolvedValue({
      telegram: {
        enabled: false,
        botUsername: "sym_bot",
        botTokenConfigured: true,
        groupChatId: "-100123",
        allowedUserIds: ["777"],
        dmPolicy: "allowlist",
        dmAllowedUserIds: ["777"],
        requireMention: true,
        pollingEnabled: false,
      },
    });

    render(<TelegramGatewaySettingsCard />);

    fireEvent.change(await screen.findByLabelText("Telegram Bot API token"), { target: { value: "123:abc" } });
    fireEvent.click(screen.getByText("Save Telegram settings"));

    await waitFor(() => expect(updateCredential).toHaveBeenCalledWith("telegram", "bot_token", "123:abc"));
    expect(updateTelegramGatewaySettings).toHaveBeenCalled();
  });
});
