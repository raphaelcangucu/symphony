import { describe, expect, it } from "vitest";

import { normalizeGatewaySettings, normalizeProjectTelegramGateway } from "@/services/gateways";

describe("gateway services", () => {
  it("normalizes global telegram settings", () => {
    const settings = normalizeGatewaySettings({
      telegram: {
        enabled: true,
        bot_username: "sym_bot",
        bot_token_configured: true,
        group_chat_id: "-100123",
        allowed_user_ids: ["777"],
        dm_policy: "allowlist",
        dm_allowed_user_ids: ["777"],
        require_mention: true,
        polling_enabled: true,
      },
    });

    expect(settings.telegram.botUsername).toBe("sym_bot");
    expect(settings.telegram.botTokenConfigured).toBe(true);
    expect(settings.telegram.dmAllowedUserIds).toEqual(["777"]);
  });

  it("normalizes project telegram binding", () => {
    const result = normalizeProjectTelegramGateway({
      global_configured: true,
      binding: {
        id: 1,
        project_slug: "macro-markets",
        conversation_id: "-100123:topic:42",
        thread_id: "42",
        default_agent_kind: "codex",
        default_mode: "explore",
        active_mode: "explore",
      },
    });

    expect(result.globalConfigured).toBe(true);
    expect(result.binding?.threadId).toBe("42");
  });
});
