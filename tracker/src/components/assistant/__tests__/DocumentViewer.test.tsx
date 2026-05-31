import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentViewer } from "@/components/assistant/DocumentViewer";
import * as issueDocumentsService from "@/services/issueDocuments";
import type { IssueDocument } from "@/types/issueDocument";

vi.mock("@/services/issueDocuments", () => ({
  readIssueDocument: vi.fn(),
}));

const readIssueDocument = vi.mocked(issueDocumentsService.readIssueDocument);

const documents: IssueDocument[] = [
  {
    id: "spec",
    kind: "spec",
    path: "docs/superpowers/specs/2026-05-31-test-design.md",
    title: "Public preview tunnel design",
    updatedAt: "2026-05-31T10:00:00Z",
  },
  {
    id: "plan",
    kind: "plan",
    path: "docs/superpowers/plans/2026-05-31-test-plan.md",
    title: "Public preview tunnel plan",
    updatedAt: "2026-05-31T11:00:00Z",
  },
  {
    id: "handoff",
    kind: "handoff",
    path: "docs/superpowers/handoffs/2026-05-31-test-handoff.md",
    title: "Public preview tunnel handoff",
    updatedAt: null,
  },
];

function renderViewer(overrides: Partial<React.ComponentProps<typeof DocumentViewer>> = {}) {
  return render(
    <DocumentViewer
      projectSlug="macro-markets"
      identifier="MAC-1"
      documents={documents}
      available
      reason={null}
      {...overrides}
    />,
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

describe("DocumentViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a helpful hint when the working tree is not ready", () => {
    renderViewer({ available: false, reason: "workspace_missing", documents: [] });

    expect(screen.getByText("The working tree is not ready yet. Documents appear once the assistant starts working.")).toBeTruthy();
    expect(readIssueDocument).not.toHaveBeenCalled();
  });

  it("shows an empty state when no documents are available yet", () => {
    renderViewer({ documents: [] });

    expect(screen.getByText("No spec or plan documents yet.")).toBeTruthy();
    expect(readIssueDocument).not.toHaveBeenCalled();
  });

  it("renders document titles with their document kind", async () => {
    readIssueDocument.mockResolvedValueOnce("# Spec");

    renderViewer();

    expect(screen.getByRole("button", { name: /Spec Public preview tunnel design/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Plan Public preview tunnel plan/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Handoff Public preview tunnel handoff/i })).toBeTruthy();
  });

  it("loads the first document and renders its markdown content", async () => {
    readIssueDocument.mockResolvedValueOnce("# Generated Spec\n\n- [x] Inspect patterns");

    renderViewer();

    expect(readIssueDocument).toHaveBeenCalledWith(
      "macro-markets",
      "MAC-1",
      "docs/superpowers/specs/2026-05-31-test-design.md",
    );
    expect(await screen.findByRole("heading", { name: "Generated Spec" })).toBeTruthy();
    expect(screen.getByText("Inspect patterns")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Spec Public preview tunnel design/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("loads and renders the selected document when switching documents", async () => {
    readIssueDocument.mockResolvedValueOnce("# Generated Spec").mockResolvedValueOnce("# Implementation Plan");

    renderViewer();

    expect(await screen.findByRole("heading", { name: "Generated Spec" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Plan Public preview tunnel plan/i }));

    expect(readIssueDocument).toHaveBeenLastCalledWith(
      "macro-markets",
      "MAC-1",
      "docs/superpowers/plans/2026-05-31-test-plan.md",
    );
    expect(await screen.findByRole("heading", { name: "Implementation Plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Plan Public preview tunnel plan/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("selects the first available document when the current document disappears", async () => {
    readIssueDocument.mockResolvedValueOnce("# Initial Plan").mockResolvedValueOnce("# Remaining Spec");

    const { rerender } = renderViewer({ documents: [documents[1], documents[2]] });
    expect(await screen.findByRole("heading", { name: "Initial Plan" })).toBeTruthy();

    rerender(
      <DocumentViewer
        projectSlug="macro-markets"
        identifier="MAC-1"
        documents={[documents[0]]}
        available
        reason={null}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Remaining Spec" })).toBeTruthy();
    expect(readIssueDocument).toHaveBeenLastCalledWith(
      "macro-markets",
      "MAC-1",
      "docs/superpowers/specs/2026-05-31-test-design.md",
    );
  });

  it("ignores stale reads when switching documents quickly", async () => {
    const firstRead = createDeferred<string>();
    const secondRead = createDeferred<string>();
    readIssueDocument.mockReturnValueOnce(firstRead.promise).mockReturnValueOnce(secondRead.promise);

    renderViewer();
    await userEvent.click(screen.getByRole("button", { name: /Plan Public preview tunnel plan/i }));

    secondRead.resolve("# Fresh Plan");
    expect(await screen.findByRole("heading", { name: "Fresh Plan" })).toBeTruthy();

    firstRead.resolve("# Stale Spec");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Stale Spec" })).toBeNull());
  });

  it("renders a friendly error state when document content cannot be loaded", async () => {
    readIssueDocument.mockRejectedValueOnce(new Error("boom"));

    renderViewer();

    expect(await screen.findByText("Could not load this document.")).toBeTruthy();
    expect(screen.getByText("Try selecting it again, or ask the assistant to regenerate the document.")).toBeTruthy();
  });
});
