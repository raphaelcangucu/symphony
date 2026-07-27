import { toByteArray } from "base64-js";

import type { HostTransport } from "@/transport/HostTransport";

const MAX_CHUNK_BYTES = 512 * 1024;

export type EvidenceFileScope = {
  hostId: string;
  projectSlug: string;
  identifier: string;
  runId: string;
  artifactPath: string;
};

export type EvidenceFilePaths = {
  partialUri: string;
  finalUri: string;
};

export interface EvidenceFileStore {
  resolve(scope: EvidenceFileScope): Promise<EvidenceFilePaths>;
  size(uri: string): Promise<number | null>;
  append(uri: string, bytes: Uint8Array): Promise<void>;
  move(sourceUri: string, destinationUri: string): Promise<void>;
}

type ArtifactChunk = {
  content: string;
  content_type: string;
  size: number;
  offset: number;
  next_offset: number;
  eof: boolean;
};

export async function downloadEvidenceArtifact({
  transport,
  hostId,
  projectSlug,
  identifier,
  runId,
  artifactPath,
  signal,
  fileStore = expoEvidenceFileStore,
  chunkBytes = MAX_CHUNK_BYTES,
}: {
  transport: HostTransport;
  hostId: string;
  projectSlug: string;
  identifier: string;
  runId: string;
  artifactPath: string;
  signal?: AbortSignal;
  fileStore?: EvidenceFileStore;
  chunkBytes?: number;
}): Promise<{ uri: string; contentType: string; size: number }> {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > MAX_CHUNK_BYTES) {
    throw new Error("Invalid evidence download chunk size");
  }

  const scope = { hostId, projectSlug, identifier, runId, artifactPath };
  const paths = await fileStore.resolve(scope);
  const cachedSize = await fileStore.size(paths.finalUri);
  if (cachedSize !== null) {
    return {
      uri: paths.finalUri,
      contentType: contentTypeForPath(artifactPath),
      size: cachedSize,
    };
  }

  let offset = (await fileStore.size(paths.partialUri)) ?? 0;
  let expectedSize: number | null = null;
  let contentType = contentTypeForPath(artifactPath);

  while (true) {
    throwIfAborted(signal);
    const raw = await transport.call<unknown>(
      "evidence.artifact.read",
      {
        project_slug: projectSlug,
        identifier,
        run_id: runId,
        path: artifactPath,
        offset,
        length: chunkBytes,
      },
      signal,
    );
    throwIfAborted(signal);

    const chunk = normalizeChunk(raw);
    if (chunk.offset !== offset) throw new Error("Evidence download offset mismatch");
    if (expectedSize !== null && chunk.size !== expectedSize) {
      throw new Error("Evidence download size changed");
    }
    expectedSize = chunk.size;
    contentType = chunk.content_type;

    if (!chunk.eof && chunk.next_offset <= offset) {
      throw new Error("Evidence download did not advance");
    }
    const bytes = decodeBase64(chunk.content);
    if (chunk.next_offset !== offset + bytes.byteLength) {
      throw new Error("Evidence download chunk length mismatch");
    }
    if (chunk.eof && chunk.next_offset !== chunk.size) {
      throw new Error("Evidence download ended before EOF");
    }

    await fileStore.append(paths.partialUri, bytes);
    offset = chunk.next_offset;

    if (chunk.eof) {
      await fileStore.move(paths.partialUri, paths.finalUri);
      return { uri: paths.finalUri, contentType, size: chunk.size };
    }
  }
}

const expoEvidenceFileStore: EvidenceFileStore = {
  async resolve(scope) {
    const { Directory, File, Paths } = await loadExpoFileSystem();
    const directory = new Directory(
      Paths.cache,
      "dev10x-evidence",
      safeComponent(scope.hostId),
      safeComponent(scope.projectSlug),
      safeComponent(scope.identifier),
      safeComponent(scope.runId),
    );
    directory.create({ idempotent: true, intermediates: true });
    const basename = safeComponent(scope.artifactPath.split("/").at(-1) || "artifact");
    const filename = `${shortHash(scope.artifactPath)}-${basename}`;
    return {
      partialUri: new File(directory, `${filename}.partial`).uri,
      finalUri: new File(directory, filename).uri,
    };
  },

  async size(uri) {
    const { File } = await loadExpoFileSystem();
    const file = new File(uri);
    return file.exists ? file.size : null;
  },

  async append(uri, bytes) {
    const { File } = await loadExpoFileSystem();
    const file = new File(uri);
    if (!file.exists) file.create({ intermediates: true });
    file.write(bytes, { append: true });
  },

  async move(sourceUri, destinationUri) {
    const { File } = await loadExpoFileSystem();
    new File(sourceUri).move(new File(destinationUri));
  },
};

let expoFileSystem: Promise<typeof import("expo-file-system")> | null = null;

function loadExpoFileSystem(): Promise<typeof import("expo-file-system")> {
  expoFileSystem ??= import("expo-file-system");
  return expoFileSystem;
}

function normalizeChunk(value: unknown): ArtifactChunk {
  if (
    !isRecord(value) ||
    typeof value.content !== "string" ||
    typeof value.content_type !== "string" ||
    !Number.isInteger(value.size) ||
    (value.size as number) < 0 ||
    !Number.isInteger(value.offset) ||
    (value.offset as number) < 0 ||
    !Number.isInteger(value.next_offset) ||
    (value.next_offset as number) < 0 ||
    typeof value.eof !== "boolean"
  ) {
    throw new Error("Symphony host returned an invalid evidence chunk");
  }
  return value as ArtifactChunk;
}

function decodeBase64(value: string): Uint8Array {
  try {
    return toByteArray(value);
  } catch {
    throw new Error("Symphony host returned invalid evidence bytes");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Evidence download aborted");
}

function safeComponent(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized && sanitized !== "." && sanitized !== ".." ? sanitized : "_";
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function contentTypeForPath(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "mp4") return "video/mp4";
  if (extension === "webm") return "video/webm";
  if (extension === "json") return "application/json";
  if (extension === "txt" || extension === "md") return "text/plain";
  if (extension === "zip") return "application/zip";
  return "application/octet-stream";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
