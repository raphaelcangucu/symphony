import axios from "axios";

import { http, trackerPath, unwrapData } from "./http";

export type DockerCommand = "start" | "stop" | "restart" | "remove";

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  createdAt: string;
  composeProject: string | null;
  composeWorkingDir: string | null;
  cpuPercent: string | null;
  memoryUsage: string | null;
}

export interface DockerOverview {
  available: boolean;
  error: string | null;
  containers: DockerContainer[];
}

export type DockerSortKey = "name" | "composeProject" | "image" | "state" | "cpuPercent";

export interface DockerProjectGroup {
  composeProject: string | null;
  composeWorkingDir: string | null;
  containers: DockerContainer[];
}

function containerGroupKey(container: DockerContainer): string {
  if (!container.composeProject) return "";
  return `${container.composeProject}\0${container.composeWorkingDir ?? ""}`;
}

export function dockerProjectGroupKey(group: DockerProjectGroup): string {
  if (group.composeProject === null) return "__unassigned__";
  return `${group.composeProject}\0${group.composeWorkingDir ?? ""}`;
}

interface BackendDockerContainerDto {
  id?: string | null;
  name?: string | null;
  image?: string | null;
  state?: string | null;
  status?: string | null;
  ports?: string | null;
  created_at?: string | null;
  compose_project?: string | null;
  compose_working_dir?: string | null;
  cpu_percent?: string | null;
  memory_usage?: string | null;
}

interface BackendDockerOverviewDto {
  available?: boolean | null;
  error?: string | null;
  containers?: BackendDockerContainerDto[] | null;
}

export function mapDockerContainer(dto: BackendDockerContainerDto): DockerContainer {
  return {
    id: dto.id ?? "",
    name: dto.name ?? "",
    image: dto.image ?? "",
    state: dto.state ?? "",
    status: dto.status ?? "",
    ports: dto.ports ?? "",
    createdAt: dto.created_at ?? "",
    composeProject: dto.compose_project ?? null,
    composeWorkingDir: dto.compose_working_dir ?? null,
    cpuPercent: dto.cpu_percent ?? null,
    memoryUsage: dto.memory_usage ?? null,
  };
}

export function compareDockerContainers(
  a: DockerContainer,
  b: DockerContainer,
  key: DockerSortKey,
): number {
  if (key === "cpuPercent") {
    return parseCpuPercent(a.cpuPercent) - parseCpuPercent(b.cpuPercent);
  }

  const left = a[key];
  const right = b[key];
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.toLowerCase().localeCompare(right.toLowerCase());
}

function parseCpuPercent(value: string | null): number {
  if (!value) return -1;
  const parsed = Number.parseFloat(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : -1;
}

function resolveGroupWorkingDir(containers: DockerContainer[]): string | null {
  for (const container of containers) {
    if (container.composeWorkingDir) return container.composeWorkingDir;
  }
  return null;
}

export function groupDockerContainersByProject(
  containers: DockerContainer[],
  sortKey: DockerSortKey,
  sortAsc: boolean,
): DockerProjectGroup[] {
  const grouped = new Map<string, DockerContainer[]>();

  for (const container of containers) {
    const key = containerGroupKey(container);
    const list = grouped.get(key) ?? [];
    list.push(container);
    grouped.set(key, list);
  }

  const groups = [...grouped.entries()].map(([groupKey, items]) => {
    const sorted = [...items].sort((a, b) => compareDockerContainers(a, b, sortKey));
    const ordered = sortAsc ? sorted : sorted.reverse();
    const composeProject = groupKey === "" ? null : (ordered[0]?.composeProject ?? null);
    return {
      composeProject,
      composeWorkingDir: resolveGroupWorkingDir(ordered),
      containers: ordered,
    };
  });

  groups.sort((a, b) => {
    if (a.composeProject === null && b.composeProject !== null) return 1;
    if (a.composeProject !== null && b.composeProject === null) return -1;
    const left = a.composeProject ?? "";
    const right = b.composeProject ?? "";
    return left.toLowerCase().localeCompare(right.toLowerCase());
  });

  if (sortKey === "composeProject" && !sortAsc) {
    groups.reverse();
  }

  return groups;
}

export async function fetchDockerOverview(signal?: AbortSignal): Promise<DockerOverview> {
  const response = await http.get(trackerPath("/docker/containers"), { signal });
  const dto = unwrapData<BackendDockerOverviewDto>(response);
  return {
    available: dto.available ?? false,
    error: dto.error ?? null,
    containers: (dto.containers ?? []).map(mapDockerContainer),
  };
}

export async function runDockerCommand(
  containerId: string,
  command: DockerCommand,
  options?: { force?: boolean },
): Promise<void> {
  await http.post(trackerPath(`/docker/containers/${containerId}/${command}`), {
    force: options?.force ?? false,
  });
}

export function describeDockerError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: { message?: unknown } } | undefined)?.error
      ?.message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return error instanceof Error ? error.message : String(error);
}
