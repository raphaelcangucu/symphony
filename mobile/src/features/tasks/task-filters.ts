import type { IssuePriority, IssueSummary } from "@/api/contracts";

export type TaskFilters = {
  query: string;
  projectSlugs: Set<string>;
  statuses: Set<string>;
  priorities: Set<IssuePriority>;
  statusOrder?: string[];
};

export type TaskGroup = {
  status: string;
  tasks: IssueSummary[];
};

export function filterAndGroupTasks(tasks: IssueSummary[], filters: TaskFilters): TaskGroup[] {
  const query = normalize(filters.query);
  const filtered = tasks.filter((task) => {
    if (filters.projectSlugs.size > 0 && !filters.projectSlugs.has(task.projectSlug)) {
      return false;
    }
    if (filters.statuses.size > 0 && !filters.statuses.has(task.status)) return false;
    if (
      filters.priorities.size > 0 &&
      (task.priority === null || !filters.priorities.has(task.priority))
    ) {
      return false;
    }
    if (!query) return true;
    return normalize(
      [
        task.title,
        task.identifier,
        task.displayIdentifier,
        task.projectSlug,
        task.assignee,
        ...task.labels,
      ]
        .filter(Boolean)
        .join(" "),
    ).includes(query);
  });

  const grouped = new Map<string, IssueSummary[]>();
  for (const task of filtered) {
    const group = grouped.get(task.status) ?? [];
    group.push(task);
    grouped.set(task.status, group);
  }

  const order = new Map((filters.statusOrder ?? []).map((status, index) => [status, index]));
  return [...grouped]
    .sort(([left], [right]) => {
      const leftOrder = order.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.localeCompare(right);
    })
    .map(([status, groupTasks]) => ({
      status,
      tasks: groupTasks.sort(
        (left, right) =>
          left.position - right.position ||
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.identifier.localeCompare(right.identifier),
      ),
    }));
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
}
