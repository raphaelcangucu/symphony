import { describe, expect, it } from "vitest";

import { normalizeEvidenceArtifactUrl } from "@/lib/normalizeEvidenceArtifactUrl";

describe("normalizeEvidenceArtifactUrl", () => {
  it("encodes spaces and parentheses in artifact path segments", () => {
    const raw =
      "http://127.0.0.1:4000/api/tracker/v1/projects/macro-markets/issues/535/evidence/run-1/artifacts/artifacts/cypress-screenshots/Symphony Preview Check (failed).png";

    expect(normalizeEvidenceArtifactUrl(raw)).toBe(
      "http://127.0.0.1:4000/api/tracker/v1/projects/macro-markets/issues/535/evidence/run-1/artifacts/artifacts/cypress-screenshots/Symphony%20Preview%20Check%20(failed).png",
    );
  });

  it("leaves already-encoded URLs unchanged", () => {
    const encoded =
      "/api/tracker/v1/projects/gam/issues/GAM-9/evidence/run/artifacts/artifacts/shot%20(1).png";

    expect(normalizeEvidenceArtifactUrl(encoded)).toBe(encoded);
  });
});
