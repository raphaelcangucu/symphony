import { describe, expect, it } from "vitest";

import {
  evidenceImageLabel,
  extractEvidenceImageUrls,
  isEvidenceComment,
  parseEvidenceComment,
} from "@/lib/evidenceComment";

const SAMPLE_BODY = `## Codex Evidence

Run \`20260617215714-1242947\` — overall **failed** (UI change: e2e + visual capture required).

| Kind | Repo | Command | Status | Summary |
|---|---|---|---|---|
| unit | backend | \`./vibe test tests/Unit/HealthChecks/HealthCheckEndpointTest.php\` | blocked | - |
| e2e | frontend | \`./node_modules/.bin/cypress run --spec cypress/e2e/symphony-preview-check.cy.ts --browser electron\` | failed | 0/1 passed, 1 failed |

![Symphony Preview Check -- shows Laravel OK when the preview backend health endpoint is healthy (failed).png](http://127.0.0.1:4000/api/tracker/v1/projects/macro-markets/issues/535/evidence/20260617215714-1242947/artifacts/artifacts/cypress-screenshots/Symphony Preview Check -- shows Laravel OK when the preview backend health endpoint is healthy (failed).png)

Full artifacts (videos, reports, traces): Evidence tab in Symphony.`;

describe("evidenceComment", () => {
  it("detects evidence comments by kind or heading", () => {
    expect(isEvidenceComment(SAMPLE_BODY, "evidence")).toBe(true);
    expect(isEvidenceComment(SAMPLE_BODY, null)).toBe(true);
    expect(isEvidenceComment("Hello world", "comment")).toBe(false);
  });

  it("parses run metadata and table rows", () => {
    const parsed = parseEvidenceComment(SAMPLE_BODY);
    expect(parsed).not.toBeNull();
    expect(parsed?.runId).toBe("20260617215714-1242947");
    expect(parsed?.overallStatus).toBe("failed");
    expect(parsed?.uiChange).toBe(true);
    expect(parsed?.runs).toHaveLength(2);
    expect(parsed?.runs[1]).toMatchObject({ kind: "e2e", status: "failed" });
  });

  it("extracts screenshot URLs even when markdown alt text contains parentheses", () => {
    const urls = extractEvidenceImageUrls(SAMPLE_BODY);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/evidence/20260617215714-1242947/artifacts/");
    expect(urls[0]).toContain("(failed).png");
  });

  it("derives a readable image label from the artifact URL", () => {
    const url =
      "http://127.0.0.1:4000/api/tracker/v1/projects/macro-markets/issues/535/evidence/run/artifacts/shot%20(1).png";
    expect(evidenceImageLabel(url)).toBe("shot (1).png");
  });
});
