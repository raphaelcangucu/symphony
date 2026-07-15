import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecentsProvider } from "@/hooks/RecentsProvider";
import { useRecents, type UseRecentsResult } from "@/hooks/useRecents";
import { usePhoenixChannel } from "@/hooks/usePhoenixChannel";
import { listRecents } from "@/services/recents";
import type { RecentSession } from "@/types/recents";

let setupChannel: ((channel: { on: (event: string, callback: (payload: unknown) => void) => void }) => void) | undefined;
const eventHandlers = new Map<string, (payload: unknown) => void>();

vi.mock("@/hooks/usePhoenixChannel", () => ({
  usePhoenixChannel: vi.fn((args: {
    onSetup?: (channel: { on: (event: string, callback: (payload: unknown) => void) => void }) => void;
  }) => {
    setupChannel = args.onSetup;
    return { channel: null, connected: true };
  }),
}));

vi.mock("@/services/recents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/recents")>()),
  listRecents: vi.fn(),
}));

const sample: RecentSession = {
  id: "chat:1",
  kind: "chat",
  scope: "freeform",
  agentKind: null,
  projectSlug: null,
  projectName: null,
  title: "Ideas",
  identifier: null,
  threadId: 1,
  status: "Active",
  statusKind: "active",
  preview: "hi",
  updatedAt: "2026-05-30T00:00:00Z",
};

function Consumer({ onValue }: { onValue: (value: UseRecentsResult) => void }) {
  onValue(useRecents());
  return null;
}

function renderProvider(children: ReactNode) {
  return render(<RecentsProvider>{children}</RecentsProvider>);
}

describe("RecentsProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    eventHandlers.clear();
    setupChannel = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => vi.useRealTimers());

  it("does not interval-poll when the channel is connected", () => {
    renderProvider(<Consumer onValue={() => undefined} />);
    vi.advanceTimersByTime(60_000);

    expect(usePhoenixChannel).toHaveBeenCalledOnce();
    expect(listRecents).not.toHaveBeenCalled();
  });

  it("applies the channel snapshot for every consumer", () => {
    const values: UseRecentsResult[] = [];
    renderProvider(
      <>
        <Consumer onValue={(value) => values.push(value)} />
        <Consumer onValue={(value) => values.push(value)} />
      </>,
    );

    act(() => {
      setupChannel?.({
        on: (event, callback) => {
          eventHandlers.set(event, callback);
        },
      });
      eventHandlers.get("snapshot")?.({ data: [sample] });
    });

    expect(values.at(-1)?.sessions).toEqual([sample]);
    expect(values.at(-1)?.loading).toBe(false);
  });
});
