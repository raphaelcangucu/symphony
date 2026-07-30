import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_BRAND, HOST_RUNTIME_NAME } from "./dev10x";

const root = resolve(__dirname, "../..");

describe("Dev10x mobile brand", () => {
  it("keeps Dev10x as the app brand and Symphony as the host runtime", () => {
    expect(APP_BRAND).toBe("Dev10x");
    expect(HOST_RUNTIME_NAME).toBe("Symphony");
    expect(readFileSync(resolve(root, "app.config.ts"), "utf8")).toContain('name: "Dev10x"');
  });

  it("records the exact Orca source and MIT attribution", () => {
    expect(readFileSync(resolve(root, "UPSTREAM_PROVENANCE.md"), "utf8")).toContain(
      "5c3c2f2b3daf9d8563581c389712d805bfb256a1",
    );
    expect(readFileSync(resolve(root, "THIRD_PARTY_NOTICES.md"), "utf8")).toContain(
      "Copyright (c) 2026 Lovecast Inc.",
    );
  });
});
