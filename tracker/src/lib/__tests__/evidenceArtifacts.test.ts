import { describe, expect, it } from "vitest";

import {
  artifactDisplayTitle,
  artifactIntent,
  artifactNavigations,
  humanizeArtifactFilename,
  runObjective,
} from "@/lib/evidenceArtifacts";
import type { EvidenceArtifactRef, EvidenceRun } from "@/types/evidence";

function run(overrides: Partial<EvidenceRun> = {}): EvidenceRun {
  return {
    kind: "e2e",
    repo: "frontend",
    command: "npx playwright test",
    status: "passed",
    ...overrides,
  };
}

function ref(overrides: Partial<EvidenceArtifactRef> = {}): EvidenceArtifactRef {
  return {
    path: "artifacts/videos/video.webm",
    label: null,
    navigations: [],
    ...overrides,
  };
}

describe("evidenceArtifacts", () => {
  it("humanizes screenshot filenames and strips issue prefixes", () => {
    expect(humanizeArtifactFilename("student-groups-page.png")).toBe("student groups page");
    expect(humanizeArtifactFilename("cde-1142-long-share-dialog-header-real-app.webm")).toBe(
      "long share dialog header real app",
    );
  });

  it("prefers explicit artifact labels over filenames", () => {
    expect(
      artifactIntent(
        run(),
        ref({
          path: "artifacts/videos/cde-1142-long-share-dialog-header-real-app.webm",
          label: "long share dialog header real app",
        }),
      ),
    ).toBe("long share dialog header real app");
  });

  it("derives intent from kebab-case filenames when label is absent", () => {
    expect(
      artifactIntent(run(), ref({ path: "artifacts/videos/cde-1142-long-share-dialog-header-real-app.webm" })),
    ).toBe("long share dialog header real app");
  });

  it("formats per-artifact navigations", () => {
    expect(
      artifactNavigations(
        run(),
        ref({
          path: "artifacts/screens/home.png",
          navigations: [
            "http://localhost:4300/health",
            "http://localhost:4300/login",
            "http://localhost:4300/advisor/9006610/dashboard",
          ],
        }),
      ),
    ).toBe("/health → /login → /advisor/9006610/dashboard");
  });

  it("builds display titles as navigations plus intent", () => {
    expect(
      artifactDisplayTitle(
        run(),
        ref({
          path: "artifacts/videos/cde-1142-long-share-dialog-header-real-app.webm",
          label: "long share dialog header real app",
          navigations: ["http://localhost:4300/health", "http://localhost:4300/login"],
        }),
      ),
    ).toBe("/health → /login — long share dialog header real app");
  });

  it("reads proof.artifacts metadata as fallback", () => {
    expect(
      artifactIntent(run({
        proof: {
          artifacts: {
            "artifacts/videos/video.webm": { label: "save group shares real app" },
          },
        },
      }), ref({ path: "artifacts/videos/video.webm" })),
    ).toBe("save group shares real app");
  });

  it("does not duplicate the command as the unit run objective", () => {
    expect(runObjective(run({ kind: "unit", command: "./vibe test tests/Feature/StudentTest.php" }))).toBeNull();
  });

  it("hides run-level objective when multiple visual artifacts exist", () => {
    expect(
      runObjective(
        run({
          proof: { title: "Student Groups list" },
          screenshots: [ref({ path: "a.png" }), ref({ path: "b.png" })],
        }),
      ),
    ).toBeNull();
  });
});
