import { describe, expect, it, vi } from "vitest";

import type { HostTransport } from "@/transport/HostTransport";

import { listTaskEvidence } from "./rpc-evidence";

describe("task evidence RPC", () => {
  it("lists evidence using only the ordinary task scope", async () => {
    const call = vi.fn().mockResolvedValue({
      records: [
        {
          run_id: "run-1",
          status: "passed",
          manifest: { issue: "DEV-1", runs: [] },
        },
      ],
    });
    const transport = { hostId: "host-a", call } as unknown as HostTransport;

    const records = await listTaskEvidence(transport, "dev10x", "DEV-1");

    expect(call).toHaveBeenCalledWith(
      "evidence.list",
      { project_slug: "dev10x", identifier: "DEV-1" },
      undefined,
    );
    expect(records.map((record) => record.runId)).toEqual(["run-1"]);
  });
});
