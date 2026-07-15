import axios, { CanceledError } from "axios";
import { describe, expect, it } from "vitest";

import { DEFAULT_HTTP_TIMEOUT_MS, LONG_RUNNING_HTTP_TIMEOUT_MS, http, isCanceledError } from "@/services/http";

describe("http instance", () => {
  it("applies the named default timeout so no request hangs forever", () => {
    expect(DEFAULT_HTTP_TIMEOUT_MS).toBeGreaterThan(0);
    expect(http.defaults.timeout).toBe(DEFAULT_HTTP_TIMEOUT_MS);
  });

  it("exposes a larger ceiling for long-running operations", () => {
    expect(LONG_RUNNING_HTTP_TIMEOUT_MS).toBeGreaterThan(DEFAULT_HTTP_TIMEOUT_MS);
  });
});

describe("isCanceledError", () => {
  it("treats axios cancellations as cancellations", () => {
    const canceled = new CanceledError("aborted");
    expect(isCanceledError(canceled)).toBe(true);
    expect(axios.isCancel(canceled)).toBe(true);
  });

  it("treats a DOMException AbortError as a cancellation", () => {
    expect(isCanceledError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("does NOT treat a real error (including timeout) as a cancellation", () => {
    const timeout = new Error("timeout of 30000ms exceeded");
    timeout.name = "AxiosError";
    expect(isCanceledError(timeout)).toBe(false);
    expect(isCanceledError(new Error("boom"))).toBe(false);
    expect(isCanceledError(null)).toBe(false);
    expect(isCanceledError(undefined)).toBe(false);
  });
});
