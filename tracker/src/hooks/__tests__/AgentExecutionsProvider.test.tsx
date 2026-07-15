import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentExecutionsProvider } from "@/hooks/AgentExecutionsProvider";
import { useAgentExecutions, type UseAgentExecutionsResult } from "@/hooks/useAgentExecutions";
import { usePhoenixChannel } from "@/hooks/usePhoenixChannel";
import { listAgentExecutions } from "@/services/agentExecutions";

let joinErrorHandler: ((reason: unknown) => void) | undefined;

vi.mock("@/hooks/usePhoenixChannel", () => ({
  usePhoenixChannel: vi.fn((args: { onJoinError?: (reason: unknown) => void }) => {
    joinErrorHandler = args.onJoinError;
    return { channel: null, connected: true };
  }),
}));

vi.mock("@/services/agentExecutions", () => ({
  listAgentExecutions: vi.fn(),
}));

function Consumer({ onValue }: { onValue: (value: UseAgentExecutionsResult) => void }) {
  onValue(useAgentExecutions());
  return null;
}

function renderProvider(children: ReactNode) {
  return render(<AgentExecutionsProvider>{children}</AgentExecutionsProvider>);
}

describe("AgentExecutionsProvider", () => {
  beforeEach(() => {
    joinErrorHandler = undefined;
    vi.clearAllMocks();
  });

  it("does not interval-poll listAgentExecutions when the channel is connected", () => {
    renderProvider(<Consumer onValue={() => undefined} />);

    expect(usePhoenixChannel).toHaveBeenCalledTimes(1);
    expect(listAgentExecutions).not.toHaveBeenCalled();
  });

  it("shares one execution map across consumers and makes one join-fallback request", async () => {
    vi.mocked(listAgentExecutions).mockResolvedValue([]);
    const values: UseAgentExecutionsResult[] = [];

    renderProvider(
      <>
        <Consumer onValue={(value) => values.push(value)} />
        <Consumer onValue={(value) => values.push(value)} />
      </>,
    );

    expect(usePhoenixChannel).toHaveBeenCalledTimes(1);
    expect(values).toHaveLength(2);
    expect(values[0].executions).toBe(values[1].executions);

    await act(async () => {
      joinErrorHandler?.({ reason: "unavailable" });
      joinErrorHandler?.({ reason: "still-unavailable" });
    });

    await waitFor(() => expect(listAgentExecutions).toHaveBeenCalledTimes(1));
  });
});
