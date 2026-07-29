import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const mobileRoot = fileURLToPath(new URL("../../../", import.meta.url));
const indexSource = readFileSync(new URL("../../../app/index.tsx", import.meta.url), "utf8");
const pairConfirmSource = readFileSync(
  new URL("../../../app/pair-confirm.tsx", import.meta.url),
  "utf8",
);
const projectsSource = readFileSync(
  new URL("../../../app/h/[hostId]/projects.tsx", import.meta.url),
  "utf8",
);
const projectSource = readFileSync(
  new URL("../../../app/h/[hostId]/projects/[projectSlug].tsx", import.meta.url),
  "utf8",
);
const homeSource = readFileSync(
  new URL("../../../src/dev10x/routes/HomeRoute.tsx", import.meta.url),
  "utf8",
);
const realHostJourney = readFileSync(
  new URL("../../../e2e/multi-host-smoke.sh", import.meta.url),
  "utf8",
);

describe("canonical machine project navigation", () => {
  it("uses the neutral HomeRoute name throughout the app", () => {
    expect(existsSync(`${mobileRoot}src/dev10x/routes/Dev10xHomeRoute.tsx`)).toBe(false);
    expect(indexSource).toContain('import { HomeRoute } from "@/dev10x/routes/HomeRoute"');
    expect(indexSource).toContain("<HomeRoute />");
    expect(homeSource).toContain("export function HomeRoute()");
  });

  it("lands pairing on projects and exposes accessible project navigation", () => {
    expect(pairConfirmSource).toContain("pairedHostLandingRoute(offer.hostId)");
    expect(homeSource).toContain("accessibilityLabel={`Abrir máquina ${item.name}`}");
    expect(projectsSource).toContain("accessibilityLabel={`Abrir projeto ${item.name}`}");
  });

  it("waits for the paired host connection before loading project data", () => {
    expect(projectsSource).toContain('if (!tracker || state !== "connected") return;');
    expect(projectSource).toContain('if (!tracker || state !== "connected") return;');
  });

  it("keeps project hierarchy in workspace, session, task order", () => {
    const workspaces = projectSource.indexOf('<Section title="Workspaces"');
    const sessions = projectSource.indexOf('<Section title="Sessões recentes"');
    const tasks = projectSource.indexOf('<Section title="Tasks"');

    expect(workspaces).toBeGreaterThan(-1);
    expect(sessions).toBeGreaterThan(workspaces);
    expect(tasks).toBeGreaterThan(sessions);
    expect(projectSource).toContain("accessibilityLabel={`Abrir task ${task.displayIdentifier}`}");
  });

  it("routes recent project sessions according to their execution scope", () => {
    expect(projectSource).toContain("hostWorktreeRoute({");
    expect(projectSource).toContain("scope: session.scope");
    expect(projectSource).not.toContain(
      "router.push(`/h/${hostId}/chat/${session.threadId}`)",
    );
  });

  it("drives the visible hierarchy in the real-host E2E before opening deep links", () => {
    expect(realHostJourney).toContain("assert_canonical_project_flow");
    expect(realHostJourney).toContain('tap_accessible "Voltar"');
    expect(realHostJourney).toContain('tap_accessible "Abrir máquina ${HOST_A_NAME}"');
    expect(realHostJourney).toContain('wait_for_text "Projetos"');
    expect(realHostJourney).toContain('tap_accessible "Abrir projeto ${HOST_A_NAME} Project"');
    expect(realHostJourney).toContain(
      'tap_accessible "Abrir workspace ${HOST_A_NAME} — Direct RPC session"',
    );
    expect(realHostJourney).toContain(
      'tap_accessible "Abrir sessão ${HOST_A_NAME} — Task execution"',
    );
    expect(realHostJourney).toContain('tap_accessible "Abrir task ${host_a_issue}"');
    expect(realHostJourney.indexOf("assert_canonical_project_flow")).toBeLessThan(
      realHostJourney.indexOf("launch_session_panel"),
    );
  });
});
