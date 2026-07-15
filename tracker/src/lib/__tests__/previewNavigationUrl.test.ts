import { describe, expect, it } from "vitest";

import { resolvePreviewNavigationUrl } from "@/lib/previewNavigationUrl";

describe("resolvePreviewNavigationUrl", () => {
  const base = "http://localhost:4300/";

  it("returns absolute URLs including multi-tenant hosts and hashes", () => {
    expect(
      resolvePreviewNavigationUrl(
        "http://mtu.localhost:4301/advisor/32555201/student-advising-note#/Advising%20Notes",
        base,
      ),
    ).toBe("http://mtu.localhost:4301/advisor/32555201/student-advising-note#/Advising%20Notes");
  });

  it("resolves root-relative and relative paths against the base URL", () => {
    expect(resolvePreviewNavigationUrl("/dashboard", base)).toBe("http://localhost:4300/dashboard");
    expect(resolvePreviewNavigationUrl("advisor/1", "http://localhost:4300/app/")).toBe(
      "http://localhost:4300/app/advisor/1",
    );
  });

  it("returns null for empty or invalid input", () => {
    expect(resolvePreviewNavigationUrl("   ", base)).toBeNull();
    expect(resolvePreviewNavigationUrl("http://[bad", base)).toBeNull();
    expect(resolvePreviewNavigationUrl("/ok", "")).toBeNull();
  });
});
