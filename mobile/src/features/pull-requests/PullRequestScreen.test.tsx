import { fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";

import type { PullRequestResult } from "@/api/contracts";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { PullRequestScreen } from "./PullRequestScreen";

const result: PullRequestResult = {
  supported: true,
  available: true,
  children: [],
  pullRequests: [
    {
      number: 7,
      title: "Complete mobile parity",
      url: "https://github.com/acme/mobile/pull/7",
      state: "open",
      repo: "acme/mobile",
      origin: "manual",
      isDraft: false,
      merged: false,
      headRef: "agent/mobile",
      baseRef: "main",
      author: "raphael",
      mergeable: "CONFLICTING",
      checksState: "failure",
      baseBehindBy: 2,
      pipelines: [
        {
          name: "CI",
          url: null,
          jobs: [{ name: "e2e", status: "COMPLETED", conclusion: "FAILURE", url: null }],
        },
      ],
      statuses: [],
      conversation: [],
    },
  ],
};

function confirmLatestAlert(alert: jest.SpyInstance, label: string) {
  const buttons = alert.mock.calls.at(-1)?.[2] as
    | Array<{ text?: string; onPress?: () => void }>
    | undefined;
  buttons?.find((button) => button.text === label)?.onPress?.();
}

describe("PullRequestScreen", () => {
  afterEach(() => jest.restoreAllMocks());

  it("keeps conflicts and failed checks visible while exposing recovery actions", () => {
    const onFix = jest.fn();
    const onRerun = jest.fn();
    const onUpdateBranch = jest.fn();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    render(
      <ThemeProvider colorScheme="dark">
        <PullRequestScreen
          busy={false}
          error="Merge blocked by required checks"
          notice={null}
          onBack={jest.fn()}
          onFix={onFix}
          onLink={jest.fn()}
          onMerge={jest.fn()}
          onRefresh={jest.fn()}
          onRerun={onRerun}
          onUnlink={jest.fn()}
          onUpdateBranch={onUpdateBranch}
          result={result}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Complete mobile parity")).toBeTruthy();
    expect(screen.getByText("Conflicts")).toBeTruthy();
    expect(screen.getByText("e2e")).toBeTruthy();
    expect(screen.getByText("FAILURE")).toBeTruthy();
    expect(screen.getByText("Merge blocked by required checks")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Update branch for PR 7" }));
    expect(onUpdateBranch).toHaveBeenCalledWith(result.pullRequests[0]);
    fireEvent.press(screen.getByRole("button", { name: "Rerun failed checks for PR 7" }));
    expect(onRerun).toHaveBeenCalledWith(result.pullRequests[0]);
    fireEvent.press(screen.getByRole("button", { name: "Request agent fix for PR 7" }));
    expect(onFix).not.toHaveBeenCalled();
    confirmLatestAlert(alert, "Request fix");
    expect(onFix).toHaveBeenCalledWith(result.pullRequests[0]);
  });

  it("links PRs and confirms unlink and merge actions", () => {
    const onLink = jest.fn();
    const onMerge = jest.fn();
    const onUnlink = jest.fn();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    render(
      <ThemeProvider colorScheme="dark">
        <PullRequestScreen
          busy={false}
          error={null}
          notice={null}
          onBack={jest.fn()}
          onFix={jest.fn()}
          onLink={onLink}
          onMerge={onMerge}
          onRefresh={jest.fn()}
          onRerun={jest.fn()}
          onUnlink={onUnlink}
          onUpdateBranch={jest.fn()}
          result={result}
        />
      </ThemeProvider>,
    );

    fireEvent.changeText(
      screen.getByLabelText("Pull request URL"),
      "https://github.com/acme/api/pull/8",
    );
    fireEvent.press(screen.getByRole("button", { name: "Link pull request" }));
    expect(onLink).toHaveBeenCalledWith("https://github.com/acme/api/pull/8");

    fireEvent.press(screen.getByRole("button", { name: "Unlink PR 7" }));
    confirmLatestAlert(alert, "Unlink");
    expect(onUnlink).toHaveBeenCalledWith(result.pullRequests[0]);

    fireEvent.press(screen.getByRole("button", { name: "Merge PR 7" }));
    confirmLatestAlert(alert, "Merge");
    expect(onMerge).toHaveBeenCalledWith(result.pullRequests[0], {
      method: "squash",
      bypass: false,
    });
  });
});
