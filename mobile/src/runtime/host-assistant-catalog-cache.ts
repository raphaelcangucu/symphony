import type { AssistantCatalog } from "@/api/contracts";
import { createRpcTrackerClient } from "@/api/rpc-tracker-client";
import type { HostTransport } from "@/transport/HostTransport";

export type HostAssistantCatalogStatus = "idle" | "loading" | "ready" | "unavailable";

export type HostAssistantCatalogState = Readonly<{
  catalog: AssistantCatalog | null;
  error: string | null;
  status: HostAssistantCatalogStatus;
}>;

type CacheEntry = {
  catalog: AssistantCatalog | null;
  error: string | null;
  pending: Promise<void> | null;
  status: HostAssistantCatalogStatus;
  transport: HostTransport;
};

const idle: HostAssistantCatalogState = {
  catalog: null,
  error: null,
  status: "idle",
};

/**
 * One catalogue request per connected machine.  The machine may have many
 * project/session routes, but the installed providers and their models are a
 * host capability, not a project capability.
 */
export class HostAssistantCatalogCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly onChange: () => void) {}

  state(hostId: string): HostAssistantCatalogState {
    const entry = this.entries.get(hostId);
    if (!entry) return idle;
    const { catalog, error, status } = entry;
    return { catalog, error, status };
  }

  warm(hostId: string, transport: HostTransport, { retry = false } = {}): void {
    const current = this.entries.get(hostId);
    if (
      current?.transport === transport &&
      (current.status === "loading" || current.status === "ready" || !retry)
    ) {
      return;
    }

    const entry: CacheEntry = {
      catalog: current?.transport === transport ? current.catalog : null,
      error: null,
      pending: null,
      status: "loading",
      transport,
    };
    this.entries.set(hostId, entry);
    this.onChange();

    entry.pending = createRpcTrackerClient(transport)
      .assistantCatalogForHost()
      .then((catalog) => {
        if (this.entries.get(hostId) !== entry) return;
        entry.catalog = catalog;
        entry.error = null;
        entry.status = "ready";
      })
      .catch((error: unknown) => {
        if (this.entries.get(hostId) !== entry) return;
        entry.catalog = null;
        entry.error = error instanceof Error ? error.message : "This machine did not provide model options";
        entry.status = "unavailable";
      })
      .finally(() => {
        if (this.entries.get(hostId) === entry) {
          entry.pending = null;
          this.onChange();
        }
      });
  }

  remove(hostId: string): void {
    if (this.entries.delete(hostId)) this.onChange();
  }
}
