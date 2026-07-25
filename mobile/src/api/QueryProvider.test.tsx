import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";

import { useConnection } from "@/auth/ConnectionProvider";

import { QueryProvider } from "./QueryProvider";

jest.mock("@/auth/ConnectionProvider", () => ({ useConnection: jest.fn() }));

function Probe({ onClient }: { onClient(client: QueryClient): void }) {
  const client = useQueryClient();
  useEffect(() => onClient(client), [client, onClient]);
  return null;
}

describe("QueryProvider", () => {
  it("clears only the previous profile's session-library cache after a switch", async () => {
    const onClient = jest.fn();
    jest.mocked(useConnection).mockReturnValue({
      activeProfile: { id: "remote-1" },
      profiles: [{ id: "remote-1" }],
    } as ReturnType<typeof useConnection>);
    const view = render(
      <QueryProvider>
        <Probe onClient={onClient} />
      </QueryProvider>,
    );
    const client = onClient.mock.calls[0]?.[0] as QueryClient;
    client.setQueryData(["host", "remote-1", "session-library", "projects"], ["old"]);
    client.setQueryData(["unrelated"], ["keep"]);

    jest.mocked(useConnection).mockReturnValue({
      activeProfile: { id: "remote-2" },
      profiles: [{ id: "remote-2" }],
    } as ReturnType<typeof useConnection>);
    view.rerender(
      <QueryProvider>
        <Probe onClient={onClient} />
      </QueryProvider>,
    );

    await waitFor(() =>
      expect(
        client.getQueryData(["host", "remote-1", "session-library", "projects"]),
      ).toBeUndefined(),
    );
    expect(client.getQueryData(["unrelated"])).toEqual(["keep"]);
    client.clear();
  });
});
