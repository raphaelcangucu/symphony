import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TRACKER_TOKEN_KEY, http, trackerPath, unwrapData } from "../http";

describe("http helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("prefixes tracker API paths", () => {
    expect(trackerPath("/projects")).toBe("/api/tracker/v1/projects");
  });

  it("rejects relative paths without a leading slash", () => {
    expect(() => trackerPath("projects")).toThrow(/must start/);
  });

  it("unwraps Phoenix-style envelopes and raw payloads", () => {
    expect(unwrapData({ data: { data: [1, 2] } })).toEqual([1, 2]);
    expect(unwrapData({ data: [1, 2] })).toEqual([1, 2]);
  });

  it("clears saved token and redirects when the tracker API returns unauthorized", async () => {
    window.localStorage.setItem(TRACKER_TOKEN_KEY, "stale-token");
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, pathname: "/tracker/projects" });

    http.defaults.adapter = async (config) => {
      throw new AxiosError("Unauthorized", "ERR_BAD_REQUEST", config, undefined, {
        config,
        data: { error: { code: "unauthorized" } },
        headers: {},
        status: 401,
        statusText: "Unauthorized",
      });
    };

    await expect(http.get(trackerPath("/projects"))).rejects.toThrow("Unauthorized");

    expect(window.localStorage.getItem(TRACKER_TOKEN_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledWith("/tracker/token");
  });
});
