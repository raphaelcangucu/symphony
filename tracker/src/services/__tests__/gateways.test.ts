import { describe, expect, it } from "vitest";

import { normalizeGatewaySettings, normalizeProjectTelegramGateway } from "@/services/gateways";

describe("gateway services", () => {
  it("normalizes global telegram settings", () => {
    const settings = normalizeGatewaySettings({
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

    expect(settings.telegram.botUsername).toBe("sym_bot");
    expect(settings.telegram.botTokenConfigured).toBe(true);
    expect(settings.telegram.dmAllowedUserIds).toEqual(["777"]);
  });

  it("normalizes project telegram binding", () => {
    const result = normalizeProjectTelegramGateway({
      globalConfigured: true,
      binding: {
        id: 1,
        projectSlug: "macro-markets",
        conversationId: "-100123:topic:42",
        threadId: "42",
        defaultAgentKind: "codex",
        defaultMode: "explore",
        activeMode: "explore",
      },
    });

    expect(result.globalConfigured).toBe(true);
    expect(result.binding?.threadId).toBe("42");
  });
});
