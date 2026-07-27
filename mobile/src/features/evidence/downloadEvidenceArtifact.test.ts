import { fromByteArray } from "base64-js";
import { describe, expect, it, vi } from "vitest";

import type { HostTransport } from "@/transport/HostTransport";

import {
  downloadEvidenceArtifact,
  type EvidenceFileScope,
  type EvidenceFileStore,
} from "./downloadEvidenceArtifact";

describe("encrypted evidence artifact download", () => {
  it("advances exact offsets, appends chunks, and atomically commits at EOF", async () => {
    const transport = fakeTransport(Uint8Array.from([1, 2, 3, 4, 5]), 2);
    const store = new MemoryFileStore();

    const result = await downloadEvidenceArtifact({
      transport,
      hostId: "host-a",
      projectSlug: "dev10x",
      identifier: "DEV-2",
      runId: "run-1",
      artifactPath: "artifacts/home.png",
      chunkBytes: 2,
      fileStore: store,
    });

    expect(transport.call).toHaveBeenNthCalledWith(
      1,
      "evidence.artifact.read",
      {
        project_slug: "dev10x",
        identifier: "DEV-2",
        run_id: "run-1",
        path: "artifacts/home.png",
        offset: 0,
        length: 2,
      },
      undefined,
    );
    expect(transport.call).toHaveBeenNthCalledWith(
      2,
      "evidence.artifact.read",
      expect.objectContaining({ offset: 2, length: 2 }),
      undefined,
    );
    expect(transport.call).toHaveBeenNthCalledWith(
      3,
      "evidence.artifact.read",
      expect.objectContaining({ offset: 4, length: 2 }),
      undefined,
    );
    expect(store.bytes(result.uri)).toEqual(Uint8Array.from([1, 2, 3, 4, 5]));
    expect(store.moves).toEqual([
      ["memory://host-a/dev10x/DEV-2/run-1/home.png.partial", result.uri],
    ]);
    expect(result).toEqual({
      uri: "memory://host-a/dev10x/DEV-2/run-1/home.png",
      contentType: "image/png",
      size: 5,
    });
  });

  it("resumes a partial host-scoped download", async () => {
    const transport = fakeTransport(Uint8Array.from([1, 2, 3, 4, 5]), 3);
    const store = new MemoryFileStore();
    const scope = scopeFor("host-b");
    const paths = await store.resolve(scope);
    await store.append(paths.partialUri, Uint8Array.from([1, 2]));

    await downloadEvidenceArtifact({
      transport,
      ...scope,
      chunkBytes: 3,
      fileStore: store,
    });

    expect(transport.call).toHaveBeenNthCalledWith(
      1,
      "evidence.artifact.read",
      expect.objectContaining({ offset: 2 }),
      undefined,
    );
    expect(store.resolvedScopes[0]?.hostId).toBe("host-b");
    expect(store.resolvedScopes[0]?.hostId).not.toBe("host-a");
  });

  it("rejects a stalled or inconsistent encrypted chunk", async () => {
    const transport = fakeTransport(Uint8Array.from([1, 2]), 2);
    vi.mocked(transport.call).mockResolvedValue({
      content: fromByteArray(Uint8Array.from([1, 2])),
      content_type: "application/octet-stream",
      size: 4,
      offset: 0,
      next_offset: 0,
      eof: false,
    });

    await expect(
      downloadEvidenceArtifact({
        transport,
        ...scopeFor("host-a"),
        fileStore: new MemoryFileStore(),
      }),
    ).rejects.toThrow("Evidence download did not advance");
  });
});

class MemoryFileStore implements EvidenceFileStore {
  readonly files = new Map<string, Uint8Array>();
  readonly moves: [string, string][] = [];
  readonly resolvedScopes: EvidenceFileScope[] = [];

  async resolve(scope: EvidenceFileScope) {
    this.resolvedScopes.push(scope);
    const root = `memory://${scope.hostId}/${scope.projectSlug}/${scope.identifier}/${scope.runId}`;
    return {
      partialUri: `${root}/home.png.partial`,
      finalUri: `${root}/home.png`,
    };
  }

  async size(uri: string) {
    return this.files.get(uri)?.byteLength ?? null;
  }

  async append(uri: string, bytes: Uint8Array) {
    const current = this.files.get(uri) ?? new Uint8Array();
    const next = new Uint8Array(current.length + bytes.length);
    next.set(current);
    next.set(bytes, current.length);
    this.files.set(uri, next);
  }

  async move(sourceUri: string, destinationUri: string) {
    const bytes = this.files.get(sourceUri);
    if (!bytes) throw new Error("missing source");
    this.files.set(destinationUri, bytes);
    this.files.delete(sourceUri);
    this.moves.push([sourceUri, destinationUri]);
  }

  bytes(uri: string) {
    return this.files.get(uri);
  }
}

function scopeFor(hostId: string): EvidenceFileScope {
  return {
    hostId,
    projectSlug: "dev10x",
    identifier: "DEV-2",
    runId: "run-1",
    artifactPath: "artifacts/home.png",
  };
}

function fakeTransport(source: Uint8Array, chunkSize: number): HostTransport {
  return {
    hostId: "host-a",
    call: vi.fn(async (_method, rawParams) => {
      const params = rawParams as { offset: number; length: number };
      const bytes = source.slice(params.offset, params.offset + Math.min(params.length, chunkSize));
      const nextOffset = params.offset + bytes.length;
      return {
        content: fromByteArray(bytes),
        content_type: "image/png",
        size: source.length,
        offset: params.offset,
        next_offset: nextOffset,
        eof: nextOffset >= source.length,
      };
    }),
    subscribe: vi.fn(async () => vi.fn()),
    reconnect: vi.fn(),
    deactivate: vi.fn(),
    close: vi.fn(),
  };
}
