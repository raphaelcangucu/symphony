import type { TrackerClient } from "@/api/contracts";

import type { HostTransport } from "./HostTransport";

type LegacyHostTransportOptions = {
  capabilities?: { methods: string[] };
  subscribe?: (
    method: string,
    params: unknown,
    onEvent: (event: unknown) => void,
  ) => Promise<() => void>;
  reconnect?: () => void;
  close?: () => void;
};

export class LegacyHostTransport implements HostTransport {
  readonly hostId: string;
  private readonly client: TrackerClient;
  private readonly options: LegacyHostTransportOptions;

  constructor(hostId: string, client: TrackerClient, options: LegacyHostTransportOptions = {}) {
    this.hostId = hostId;
    this.client = client;
    this.options = options;
  }

  call<TResult>(method: string, params: unknown, signal?: AbortSignal): Promise<TResult> {
    const input = asRecord(params);

    switch (method) {
      case "system.health":
        return this.client.health(signal) as Promise<TResult>;
      case "projects.list":
        return this.client.projects(signal) as Promise<TResult>;
      case "tasks.list":
        return this.client.issues(
          requiredString(input.project_slug, "project_slug"),
          {
            ...(typeof input.query === "string" ? { query: input.query } : {}),
            ...(typeof input.assignee === "string" ? { assignee: input.assignee } : {}),
            ...(typeof input.creator === "string" ? { creator: input.creator } : {}),
          },
          signal,
        ) as Promise<TResult>;
      case "sessions.list":
        return this.client.threads(
          {
            ...(typeof input.project_slug === "string" ? { projectSlug: input.project_slug } : {}),
            ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
            ...(typeof input.include_archived === "boolean"
              ? { includeArchived: input.include_archived }
              : {}),
          },
          signal,
        ) as Promise<TResult>;
      case "system.capabilities":
        return Promise.resolve(
          (this.options.capabilities ?? {
            methods: ["projects.list", "tasks.list", "sessions.list"],
          }) as TResult,
        );
      default:
        return Promise.reject(new Error(`Legacy Symphony transport does not support ${method}`));
    }
  }

  subscribe<TEvent>(
    method: string,
    params: unknown,
    onEvent: (event: TEvent, eventName?: string) => void,
  ): Promise<() => void> {
    if (!this.options.subscribe) {
      return Promise.reject(
        new Error(`Legacy Symphony stream adapter is not configured for ${method}`),
      );
    }
    return this.options.subscribe(method, params, (event) => onEvent(event as TEvent));
  }

  reconnect(): void {
    this.options.reconnect?.();
  }

  close(): void {
    this.options.close?.();
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Host transport params must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Host transport requires ${name}`);
  }
  return value;
}
