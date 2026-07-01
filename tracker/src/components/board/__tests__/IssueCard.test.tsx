import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";

import { IssueCard } from "@/components/board/IssueCard";
import type { Issue } from "@/types/issue";

const baseIssue: Issue = {
  id: "2",
  identifier: "2",
  projectSlug: "xip",
  status: "Done",
  title: "Aplicativo IOS",
  description: null,
  priority: null,
  position: 0,
  labels: [],
  blockedBy: [],
  assignee: null,
  creator: null,
  url: "https://github.com/xipcash/ios/issues/2",
  branchName: null,
  createdAt: "",
  updatedAt: "",
  attachments: [],
  repositoryFullName: "xipcash/ios",
  parentIdentifier: null,
  subIssueSummary: { total: 4, completed: 4, percentCompleted: 100 },
};

function renderCard(issue: Issue) {
  return render(<IssueCard issue={issue} onSelect={() => {}} presentational />);
}

describe("IssueCard subtask metadata", () => {
  it("shows the repository identifier", () => {
    renderCard(baseIssue);
    expect(screen.getByText("xipcash/ios")).toBeInTheDocument();
  });

  it("shows the sub-issue progress", () => {
    renderCard(baseIssue);
    expect(screen.getByText("4 / 4")).toBeInTheDocument();
  });

  it("omits the progress pill when there are no sub-issues", () => {
    renderCard({ ...baseIssue, subIssueSummary: null });
    expect(screen.queryByText("4 / 4")).not.toBeInTheDocument();
  });
});
