import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mobileRoot = resolve(__dirname, "../..");
const orcaRoot = resolve(__dirname);

describe("pinned Orca presentation import", () => {
  it("records the exact upstream revision", () => {
    expect(readFileSync(resolve(mobileRoot, "ORCA_UPSTREAM.md"), "utf8")).toContain(
      "5c3c2f2b3daf9d8563581c389712d805bfb256a1",
    );
  });

  it.each([
    "components/BottomDrawer.tsx",
    "components/WorktreeListRow.tsx",
    "files/MobileFileExplorerPanel.tsx",
    "session/TerminalPaneView.tsx",
    "source-control/MobileSourceControlPanel.tsx",
    "tasks/mobile-work-items.ts",
    "terminal/TerminalWebView.tsx",
    "theme/mobile-theme.ts",
    "worktree/workspace-view-settings.ts",
  ])("includes %s", (relativePath) => {
    expect(existsSync(resolve(orcaRoot, relativePath))).toBe(true);
  });
});
