import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostTransport } from "@/transport/HostTransport";

import { HostAssistantCatalogCache } from "./host-assistant-catalog-cache";

const { assistantCatalogForHost } = vi.hoisted(() => ({ assistantCatalogForHost: vi.fn() }));

vi.mock("@/api/rpc-tracker-client", () => ({
  createRpcTrackerClient: () => ({ assistantCatalogForHost }),
}));

describe("HostAssistantCatalogCache", () => {
  beforeEach(() => assistantCatalogForHost.mockReset());

  it("loads once per machine and reuses the ready catalogue across chat routes", async () => {
    assistantCatalogForHost.mockResolvedValue({
      defaultAgent: "codex",
      agents: [{ agent: "codex", agentLabel: "Codex", defaultModel: "gpt-5.6", models: [] }],
    });
    const onChange = vi.fn();
    const cache = new HostAssistantCatalogCache(onChange);
    const transport = { hostId: "host-a" } as HostTransport;

    cache.warm("host-a", transport);
    cache.warm("host-a", transport);
    await vi.waitFor(() => expect(cache.state("host-a").status).toBe("ready"));

    expect(assistantCatalogForHost).toHaveBeenCalledTimes(1);
    expect(cache.state("host-a").catalog?.agents[0]?.agent).toBe("codex");

    cache.warm("host-a", transport);
    expect(assistantCatalogForHost).toHaveBeenCalledTimes(1);
  });

  it("keeps an unavailable result until the machine reconnects and explicitly retries", async () => {
    assistantCatalogForHost.mockRejectedValueOnce(new Error("provider catalogue timed out"));
    const cache = new HostAssistantCatalogCache(vi.fn());
    const transport = { hostId: "host-a" } as HostTransport;

    cache.warm("host-a", transport);
    await vi.waitFor(() => expect(cache.state("host-a").status).toBe("unavailable"));
    cache.warm("host-a", transport);
    expect(assistantCatalogForHost).toHaveBeenCalledTimes(1);

    assistantCatalogForHost.mockResolvedValueOnce({ defaultAgent: "codex", agents: [] });
    cache.warm("host-a", transport, { retry: true });
    await vi.waitFor(() => expect(cache.state("host-a").status).toBe("ready"));
    expect(assistantCatalogForHost).toHaveBeenCalledTimes(2);
  });
});
