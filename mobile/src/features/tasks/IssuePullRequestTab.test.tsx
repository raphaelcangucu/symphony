import { render, screen } from "@testing-library/react-native";

import type { PullRequest } from "@/api/contracts";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { IssuePullRequestTab } from "./IssuePullRequestTab";

const pullRequest: PullRequest = {
  number: 418,
  title: "feat(mobile): task navigation",
  url: "https://github.com/dev10x/symphony/pull/418",
  state: "open",
  repo: "dev10x/symphony",
  origin: "auto",
  isDraft: false,
  merged: false,
  headRef: "codex/vin-3",
  baseRef: "main",
  author: "raphael",
  mergeable: "conflicting",
  checksState: "failure",
  pipelines: [
    {
      name: "CI",
      url: null,
      jobs: [
        { name: "Build", status: "completed", conclusion: "success", url: null },
        { name: "Lint", status: "completed", conclusion: "failure", url: null },
      ],
    },
  ],
  statuses: [],
  conversation: [],
  baseBehindBy: 0,
};

describe("IssuePullRequestTab", () => {
  it("uses labeled semantic states and calls out merge-blocking problems", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <IssuePullRequestTab
          loading={false}
          error={null}
          pullRequests={[pullRequest]}
          onOpen={jest.fn()}
          onRefresh={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("PR #418")).toBeTruthy();
    expect(screen.getByText("Build")).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("Lint")).toBeTruthy();
    expect(screen.getAllByText("Failed")).toHaveLength(2);
    expect(screen.getByText("2 problems block merge")).toBeTruthy();
  });
});
