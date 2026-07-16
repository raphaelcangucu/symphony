import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EvidenceTab } from "../EvidenceTab";
import { i18n } from "@/i18n";
import { initTestI18n } from "@/i18n/testUtils";
import type { EvidenceRecord } from "@/types/evidence";
import type { Issue } from "@/types/issue";

vi.mock("@/components/shared/AttachmentVideo", () => ({
  AttachmentVideo: ({
    src,
    label,
    description,
  }: {
    src: string;
    label: string;
    description?: string;
  }) => (
    <div data-testid="attachment-video" data-src={src} data-description={description ?? ""}>
      {label}
    </div>
  ),
}));

vi.mock("@/components/issues/issue-detail/EvidenceTextViewer", () => ({
  EvidenceTextViewerTrigger: ({ label, url }: { label: string; url: string }) => (
    <button data-testid="evidence-text-trigger" data-url={url} type="button">
      {label}
    </button>
  ),
}));

vi.mock("@/components/shared/AttachmentImage", () => ({
  AttachmentImage: ({ src, alt }: { src: string; alt: string }) => (
    <img data-testid="attachment-image" src={src} alt={alt} />
  ),
}));

const clearFailedIssueEvidenceMock = vi.hoisted(() => vi.fn());
const clearIssueEvidenceMock = vi.hoisted(() => vi.fn());
const deleteEvidenceRunMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/evidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/evidence")>();
  return {
    ...actual,
    clearFailedIssueEvidence: (...args: unknown[]) => clearFailedIssueEvidenceMock(...args),
    clearIssueEvidence: (...args: unknown[]) => clearIssueEvidenceMock(...args),
    deleteEvidenceRun: (...args: unknown[]) => deleteEvidenceRunMock(...args),
  };
});

const dispatchIssueAgentMock = vi.hoisted(() => vi.fn());
const gitDiffLauncherPropsMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issueDispatch", () => ({
  dispatchIssueAgent: (...args: unknown[]) => dispatchIssueAgentMock(...args),
}));

vi.mock("@/components/issues/issue-detail/git-diff/GitDiffLauncher", () => ({
  GitDiffLauncher: (props: {
    focusCommitRequestId?: number;
    focusCommit?: { repo: string; sha: string } | null;
    showTrigger?: boolean;
  }) => {
    gitDiffLauncherPropsMock(props);
    return (
      <div
        data-testid="git-diff-launcher-probe"
        data-focus-commit-request-id={String(props.focusCommitRequestId ?? 0)}
        data-focus-commit={
          props.focusCommit ? `${props.focusCommit.repo}:${props.focusCommit.sha}` : ""
        }
      />
    );
  },
}));

const baseProps = {
  projectSlug: "advising",
  identifier: "CDE-1131",
  loading: false,
  error: null,
  onRefresh: vi.fn(),
};

const issue = {
  id: "1",
  identifier: "CDE-1131",
  title: "Evidence gap",
  status: "Revisão de pares",
  priority: 0,
  assignee: null,
  projectSlug: "advising",
  blockedBy: [],
  labels: [],
} as unknown as Issue;

const trackerConfig = {
  activeStates: ["Em andamento"],
  dispatchStates: ["Selected for Development"],
  waitStates: ["Revisão de pares"],
  terminalStates: ["Concluído"],
  reworkTarget: "Em andamento",
};

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: 1,
    runId: "20260610-1",
    sessionId: null,
    status: "passed",
    uiChange: true,
    insertedAt: "2026-06-10T12:00:00Z",
    runs: [
      {
        kind: "unit",
        repo: "advising",
        command: "./vibe test",
        status: "passed",
        summary: { total: 3, passed: 3, failed: 0 },
        report: "artifacts/unit.txt",
        screenshots: [],
        videos: [],
        trace: null,
      },
    ],
    ...overrides,
  };
}

describe("EvidenceTab", () => {
  beforeEach(async () => {
    await initTestI18n("pt-BR");
    clearFailedIssueEvidenceMock.mockReset();
    clearIssueEvidenceMock.mockReset();
    deleteEvidenceRunMock.mockReset();
    clearFailedIssueEvidenceMock.mockResolvedValue(1);
    clearIssueEvidenceMock.mockResolvedValue(2);
    deleteEvidenceRunMock.mockResolvedValue(undefined);
  });

  function renderTab(ui: React.ReactElement) {
    return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
  }

  it("shows the empty state when there are no records", () => {
    renderTab(<EvidenceTab {...baseProps} records={[]} />);
    expect(screen.getByText(i18n.t("issue.evidence.tab.empty"))).toBeInTheDocument();
  });

  it("shows continue work when evidence is missing in review", () => {
    renderTab(
      <EvidenceTab
        {...baseProps}
        issue={issue}
        records={[]}
        showContinueWork
        trackerConfig={trackerConfig}
      />,
    );

    expect(screen.getByText(/Evidence: ausente/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /voltar para em andamento e retomar/i })).toBeInTheDocument();
  });

  it("shows continue work when the latest evidence failed", async () => {
    dispatchIssueAgentMock.mockResolvedValue({
      action: "continue_work",
      message: "Continuing",
      issue: { ...issue, status: "Em andamento" },
    });

    const user = userEvent.setup();
    renderTab(
      <EvidenceTab
        {...baseProps}
        issue={issue}
        records={[
          record({
            status: "failed",
            runs: [
              {
                kind: "unit",
                repo: "advising",
                command: "./vibe test",
                status: "blocked",
                summary: { reason: "Docker is not running." },
                report: "artifacts/phpunit.txt",
              },
            ],
          }),
        ]}
        showContinueWork
        trackerConfig={trackerConfig}
      />,
    );

    expect(screen.getByText(/Retomar validação/)).toBeInTheDocument();
    expect(screen.getAllByText(/Docker is not running/).length).toBeGreaterThan(0);
    expect(screen.getByText(i18n.t("issue.evidence.status.blocked"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /voltar para em andamento e retomar/i }));
    expect(dispatchIssueAgentMock).toHaveBeenCalled();
  });

  it("shows the error message", () => {
    renderTab(<EvidenceTab {...baseProps} error="Could not load evidence." records={[]} />);
    expect(screen.getByText("Could not load evidence.")).toBeInTheDocument();
  });

  it("clears failed evidence runs after confirmation", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    renderTab(
      <EvidenceTab
        {...baseProps}
        onRefresh={onRefresh}
        records={[record({ status: "failed" })]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /limpar falhas/i }));
    expect(clearFailedIssueEvidenceMock).toHaveBeenCalledWith("advising", "CDE-1131");
    expect(onRefresh).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("renders run sections, screenshots, videos, and text report triggers", () => {
    renderTab(
      <EvidenceTab
        {...baseProps}
        records={[
          record({
            runs: [
              {
                kind: "unit",
                repo: "frontend",
                command: "npm test",
                status: "passed",
                summary: { total: 3, passed: 3, failed: 0 },
                report: "artifacts/unit.txt",
                screenshots: [],
                videos: [],
                trace: null,
              },
              {
                kind: "e2e",
                repo: "frontend",
                command: "npx playwright test",
                status: "passed",
                summary: { total: 1, passed: 1, failed: 0 },
                report: null,
                screenshots: [
                  {
                    path: "artifacts/screens/home.png",
                    label: "Home page flow",
                    navigations: ["http://localhost:4302/home"],
                  },
                ],
                videos: [
                  {
                    path: "artifacts/videos/flow.webm",
                    label: "Home page flow",
                  },
                ],
                trace: "artifacts/trace.zip",
                proof: { title: "Home page flow" },
                navigations: ["http://localhost:4302/home"],
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText(i18n.t("issue.evidence.tab.runSection.unitTitle", { repo: "frontend" }))).toBeInTheDocument();
    expect(screen.getByText(/Teste end-to-end — frontend/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Home page flow/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("npm test").length).toBeGreaterThan(0);
    expect(screen.getByText(i18n.t("issue.evidence.tab.runSummary", { passed: 3, total: 3, failed: 0 }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("issue.evidence.tab.uiChange"))).toBeInTheDocument();

    const image = screen.getByTestId("attachment-image");
    expect(image.getAttribute("src")).toContain(
      "/projects/advising/issues/CDE-1131/evidence/20260610-1/artifacts/artifacts/screens/home.png",
    );
    expect(image).toHaveAttribute("alt", "/home — Home page flow");

    const video = screen.getByTestId("attachment-video");
    expect(video.getAttribute("data-src")).toContain("artifacts/videos/flow.webm");
    expect(video.getAttribute("data-description")).toBe("");
    expect(screen.getByText("flow.webm")).toBeInTheDocument();

    const reportTrigger = screen.getByTestId("evidence-text-trigger");
    expect(reportTrigger).toHaveTextContent(
      i18n.t("issue.evidence.tab.reportLink", { kind: "unit", repo: "frontend" }),
    );
    expect(reportTrigger.getAttribute("data-url")).toContain("artifacts/unit.txt");

    const traceLink = screen.getByRole("link", { name: /trace e2e \(frontend\)/i });
    expect(traceLink.getAttribute("href")).toContain("artifacts/trace.zip");
  });

  it("groups evidence runs by plan task title", () => {
    renderTab(
      <EvidenceTab
        {...baseProps}
        records={[
          record({
            runs: [
              {
                task_id: "task-3",
                task_title: "Task 3: Add Tasks, Review, And Runs Namespace",
                kind: "unit",
                repo: "admin",
                command: "bun run test -- tasks",
                status: "passed",
                summary: { total: 2, passed: 2, failed: 0 },
              },
              {
                task_id: "task-3",
                task_title: "Task 3: Add Tasks, Review, And Runs Namespace",
                kind: "e2e",
                repo: "admin",
                command: "npx playwright test tasks.spec.js",
                status: "passed",
                summary: { total: 1, passed: 1, failed: 0 },
              },
              {
                kind: "unit",
                repo: "backend",
                command: ".venv/bin/python -m pytest tests/test_modules.py",
                status: "passed",
                summary: { total: 6, passed: 6, failed: 0 },
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText("Task 3: Add Tasks, Review, And Runs Namespace")).toBeInTheDocument();
    expect(screen.getByText("Evidência sem tarefa vinculada")).toBeInTheDocument();
    expect(screen.getByText("bun run test -- tasks")).toBeInTheDocument();
    expect(screen.getByText("npx playwright test tasks.spec.js")).toBeInTheDocument();
    expect(screen.getByText(".venv/bin/python -m pytest tests/test_modules.py")).toBeInTheDocument();
  });

  it("renders agent commits and opens the workspace diff modal on click", async () => {
    gitDiffLauncherPropsMock.mockClear();
    const user = userEvent.setup();
    renderTab(
      <EvidenceTab
        {...baseProps}
        commits={[
          {
            repo: "advising",
            sha: "abc123def456",
            shortSha: "abc123d",
            message: "feat: agent work",
            author: "Symphony Agent",
            authoredAt: "2026-06-10T12:00:00Z",
            filesChanged: 1,
            insertions: 2,
            deletions: 0,
            online: false,
          },
        ]}
        commitWorkspace={{ path: "/tmp/ws", available: true }}
        onRefreshCommits={vi.fn()}
        records={[]}
      />,
    );

    expect(screen.getByText(i18n.t("issue.commits.title"))).toBeInTheDocument();
    expect(screen.getByTestId("git-diff-launcher-probe")).toHaveAttribute(
      "data-focus-commit-request-id",
      "0",
    );

    await user.click(screen.getByTestId("commit-evidence-abc123d"));

    expect(screen.getByTestId("git-diff-launcher-probe")).toHaveAttribute(
      "data-focus-commit-request-id",
      "1",
    );
    expect(screen.getByTestId("git-diff-launcher-probe")).toHaveAttribute(
      "data-focus-commit",
      "advising:abc123def456",
    );
  });
});
