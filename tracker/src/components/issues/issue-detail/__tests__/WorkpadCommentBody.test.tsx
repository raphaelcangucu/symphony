import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkpadCommentBody } from "@/components/issues/issue-detail/WorkpadCommentBody";

const SAMPLE_BODY = `## Codex Workpad

### Validation
Pending rework validation.

<!-- symphony:prs {"repo":"civitaslearning/advising","prs":[{"number":9455,"url":"https://github.com/civitaslearning/advising/pull/9455","base":"pre-release","head":"feature/lti-group-sharing-CDE-1106","status":"active"},{"number":9599,"url":"https://github.com/civitaslearning/advising/pull/9599","status":"closed_superseded_unlinked"}]} -->`;

describe("WorkpadCommentBody", () => {
  it("renders structured sections and pull requests instead of raw machine block", () => {
    render(<WorkpadCommentBody body={SAMPLE_BODY} />);

    expect(screen.getByText("Validation")).toBeInTheDocument();
    expect(screen.getByText("Pending rework validation.")).toBeInTheDocument();
    expect(screen.getByText("civitaslearning/advising#9455")).toBeInTheDocument();
    expect(screen.getByText("pre-release ← feature/lti-group-sharing-CDE-1106")).toBeInTheDocument();
    expect(screen.queryByText(/symphony:prs/)).not.toBeInTheDocument();
  });
});
