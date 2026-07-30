import { describe, expect, it } from "vitest";

import type { IssueSummary } from "@/api/contracts";

import { filterAndGroupTasks } from "./task-filters";

const tasks: IssueSummary[] = [
  {
    id: "1",
    identifier: "MOB-1",
    displayIdentifier: "MOB-1",
    projectSlug: "mobile",
    title: "Autenticação móvel",
    description: null,
    status: "In Progress",
    priority: 1,
    position: 2,
    labels: ["Segurança"],
    assignee: "Raphael",
    creator: null,
    agentKind: "codex",
    agentGoal: null,
    branchName: null,
    createdAt: "",
    updatedAt: "2026-07-24T02:00:00Z",
  },
  {
    id: "2",
    identifier: "API-2",
    displayIdentifier: "API-2",
    projectSlug: "api",
    title: "OAuth callback",
    description: null,
    status: "Todo",
    priority: 2,
    position: 1,
    labels: ["Backend"],
    assignee: "Ana",
    creator: null,
    agentKind: null,
    agentGoal: null,
    branchName: null,
    createdAt: "",
    updatedAt: "2026-07-24T01:00:00Z",
  },
];

describe("filterAndGroupTasks", () => {
  it("combines diacritic-insensitive search with project, status, and priority filters", () => {
    expect(
      filterAndGroupTasks(tasks, {
        query: "autenticacao",
        projectSlugs: new Set(["mobile"]),
        statuses: new Set(["In Progress"]),
        priorities: new Set([1]),
      }),
    ).toEqual([
      {
        status: "In Progress",
        tasks: [tasks[0]],
      },
    ]);
  });

  it("searches identifier, labels, and assignee and preserves workflow status order", () => {
    const groups = filterAndGroupTasks(tasks, {
      query: "ana",
      projectSlugs: new Set(),
      statuses: new Set(),
      priorities: new Set(),
      statusOrder: ["Todo", "In Progress"],
    });

    expect(groups.map((group) => group.status)).toEqual(["Todo"]);
    expect(groups[0]?.tasks.map((task) => task.identifier)).toEqual(["API-2"]);

    expect(
      filterAndGroupTasks(tasks, {
        query: "seguranca",
        projectSlugs: new Set(),
        statuses: new Set(),
        priorities: new Set(),
      })[0]?.tasks[0]?.identifier,
    ).toBe("MOB-1");
  });
});
