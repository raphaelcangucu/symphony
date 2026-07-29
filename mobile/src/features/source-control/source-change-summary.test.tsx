import { sourceChangeSummary } from "./source-change-summary";

describe("sourceChangeSummary", () => {
  it("returns a single session-level summary across repositories", () => {
    expect(
      sourceChangeSummary({
        workspace: { path: "/workspace", available: true },
        stats: [
          {
            repo: "admin",
            branch: "agent/task",
            base: "main",
            filesChanged: 2,
            additions: 12,
            deletions: 3,
            untracked: 0,
          },
          {
            repo: "website",
            branch: "agent/task",
            base: "main",
            filesChanged: 1,
            additions: 4,
            deletions: 7,
            untracked: 1,
          },
        ],
      }),
    ).toEqual({ filesChanged: 3, additions: 16, deletions: 10 });
  });

  it("hides Changes when the workspace has no source mutation", () => {
    expect(
      sourceChangeSummary({
        workspace: { path: "/workspace", available: true },
        stats: [
          {
            repo: "website",
            branch: "main",
            base: "main",
            filesChanged: 0,
            additions: 0,
            deletions: 0,
            untracked: 0,
          },
        ],
      }),
    ).toBeNull();
  });
});
