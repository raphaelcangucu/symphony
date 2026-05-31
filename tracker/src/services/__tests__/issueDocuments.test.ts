import { afterEach, describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import {
  listIssueDocuments,
  normalizeIssueDocument,
  normalizeIssueDocumentList,
  readIssueDocument,
} from "@/services/issueDocuments";

describe("normalizeIssueDocument", () => {
  afterEach(() => vi.restoreAllMocks());

  it("normalizes snake_case", () => {
    const doc = normalizeIssueDocument({
      id: "a",
      kind: "spec",
      path: "docs/superpowers/specs/a.md",
      title: "A",
      updated_at: "2026-05-31T00:00:00Z",
    });

    expect(doc.updatedAt).toBe("2026-05-31T00:00:00Z");
    expect(doc.kind).toBe("spec");
  });

  it("defaults invalid kinds to spec", () => {
    const doc = normalizeIssueDocument({
      id: "a",
      kind: "unexpected",
      path: "docs/superpowers/specs/a.md",
      title: "A",
      updated_at: null,
    });

    expect(doc.kind).toBe("spec");
  });

  it("defaults available list", () => {
    const list = normalizeIssueDocumentList({
      available: false,
      reason: "workspace_missing",
      documents: [],
    });

    expect(list.available).toBe(false);
    expect(list.documents).toEqual([]);
  });

  it("lists documents through an encoded tracker API path", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        data: {
          available: true,
          reason: null,
          documents: [
            {
              id: "a",
              kind: "plan",
              path: "docs/superpowers/plans/a.md",
              title: "A",
              updated_at: "2026-05-31T00:00:00Z",
            },
          ],
        },
      },
    });

    const list = await listIssueDocuments("macro markets", "#508");

    expect(get).toHaveBeenCalledWith("/api/tracker/v1/projects/macro%20markets/issues/508/documents");
    expect(list.documents[0]).toMatchObject({ kind: "plan", updatedAt: "2026-05-31T00:00:00Z" });
  });

  it("reads document content with encoded path segments", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: { data: { content: "# Plan" } },
    });

    const content = await readIssueDocument("macro markets", "ISSUE-1", "docs/superpowers/plans/a b.md");

    expect(get).toHaveBeenCalledWith(
      "/api/tracker/v1/projects/macro%20markets/issues/ISSUE-1/documents/docs/superpowers/plans/a%20b.md",
    );
    expect(content).toBe("# Plan");
  });

  it("rejects parent directory document path segments", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: { data: { content: "# Plan" } },
    });

    await expect(readIssueDocument("macro markets", "ISSUE-1", "../x.md")).rejects.toThrow(
      "Document path cannot include . or .. segments",
    );

    expect(get).not.toHaveBeenCalled();
  });

  it("rejects current directory document path segments", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({
      data: { data: { content: "# Plan" } },
    });

    await expect(readIssueDocument("macro markets", "ISSUE-1", "docs/./x.md")).rejects.toThrow(
      "Document path cannot include . or .. segments",
    );

    expect(get).not.toHaveBeenCalled();
  });
});
