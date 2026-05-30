import { describe, expect, it, vi } from "vitest";

import {
  fetchIssueDevServers,
  restartIssueDevServers,
  startIssueDevServers,
  stopIssueDevServers,
} from "@/services/issueDevServers";
import { http } from "@/services/http";
import type { IssueDevServersResponse } from "@/types/issue";

describe("issue dev-server service", () => {
  const response: IssueDevServersResponse = {
    available: true,
    reason: null,
    servers: [
      {
        id: 1,
        slug: "web",
        working_dir: "tracker",
        port: 5173,
        url: "http://127.0.0.1:5173",
        status: "ready",
        primary: true,
        session_name: "sym-issue-macro-markets-#508-web",
      },
    ],
  };

  it("fetches issue dev servers and unwraps the response data", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { data: response } });

    const result = await fetchIssueDevServers("macro markets", "#508");

    expect(get).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro%20markets/issues/%23508/dev_servers",
    );
    expect(result).toEqual(response);
  });

  it("starts issue dev servers through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: response } });

    const result = await startIssueDevServers("macro-markets", "MAC-1");

    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro-markets/issues/MAC-1/dev_servers/start",
    );
    expect(result).toEqual(response);
  });

  it("stops issue dev servers through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: response } });

    const result = await stopIssueDevServers("macro-markets", "MAC-1");

    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro-markets/issues/MAC-1/dev_servers/stop",
    );
    expect(result).toEqual(response);
  });

  it("restarts issue dev servers through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { data: response } });

    const result = await restartIssueDevServers("macro-markets", "MAC-1");

    expect(post).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro-markets/issues/MAC-1/dev_servers/restart",
    );
    expect(result).toEqual(response);
  });
});
