import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EvidenceCommentBody } from "@/components/issues/issue-detail/EvidenceCommentBody";

vi.mock("@/components/shared/AttachmentImage", () => ({
  AttachmentImage: ({ src, alt }: { src: string; alt: string }) => (
    <img data-testid="attachment-image" src={src} alt={alt} />
  ),
}));

const SAMPLE_BODY = `## Codex Evidence

Run \`20260617215714-1242947\` — overall **failed** (UI change: e2e + visual capture required).

| Kind | Repo | Command | Status | Summary |
|---|---|---|---|---|
| e2e | frontend | \`cypress run\` | failed | 0/1 passed, 1 failed |

![Symphony Preview Check (failed).png](http://127.0.0.1:4000/api/tracker/v1/projects/macro-markets/issues/535/evidence/20260617215714-1242947/artifacts/artifacts/cypress-screenshots/Symphony Preview Check (failed).png)

Full artifacts (videos, reports, traces): Evidence tab in Symphony.`;

describe("EvidenceCommentBody", () => {
  it("renders a structured evidence summary with screenshots instead of raw markdown", () => {
    render(<EvidenceCommentBody body={SAMPLE_BODY} />);

    expect(screen.getByText("20260617215714-1242947")).toBeInTheDocument();
    // Status pills render the localized label ("Failed"), not the raw status.
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(screen.getByText("e2e")).toBeInTheDocument();
    expect(screen.getByText("0/1 passed, 1 failed")).toBeInTheDocument();

    const image = screen.getByTestId("attachment-image");
    expect(image).toHaveAttribute(
      "src",
      "http://127.0.0.1:4000/api/tracker/v1/projects/macro-markets/issues/535/evidence/20260617215714-1242947/artifacts/artifacts/cypress-screenshots/Symphony%20Preview%20Check%20(failed).png",
    );
    expect(image).toHaveAttribute("alt", "Symphony Preview Check (failed).png");
    expect(screen.queryByText(/!\[Symphony Preview Check/)).not.toBeInTheDocument();
  });
});
