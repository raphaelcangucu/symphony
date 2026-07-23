export interface ConnectionProfile {
  id: string;
  name: string;
  origin: string;
  createdAt: string;
  lastConnectedAt: string | null;
}

export interface ConnectionCredential {
  profileId: string;
  token: string;
}

export interface ParsedConnectionLink {
  origin: string;
  token: string;
}

export interface CreateConnectionProfileInput {
  name: string;
  origin: string;
}

export interface ConnectionProfileFactories {
  createId: () => string;
  now: () => string;
}

const TRACKER_PATH_SEGMENT = "/tracker";

export function createConnectionProfile(
  input: CreateConnectionProfileInput,
  factories: ConnectionProfileFactories,
): ConnectionProfile {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Connection name is required");
  }

  return {
    id: factories.createId(),
    name,
    origin: normalizeTrackerOrigin(input.origin),
    createdAt: factories.now(),
    lastConnectedAt: null,
  };
}

export function normalizeTrackerOrigin(input: string): string {
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("Only http and https tracker URLs are supported");
  }
  if (/^https?:\/\/\//i.test(value)) {
    throw new Error("Tracker URL must include a host");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Tracker URL must include a host");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https tracker URLs are supported");
  }
  if (!url.hostname) {
    throw new Error("Tracker URL must include a host");
  }
  if (url.username || url.password) {
    throw new Error("Tracker URLs must not contain credentials");
  }
  if (url.hash) {
    throw new Error("Tracker URLs must not contain fragments");
  }

  const trackerIndex = trackerSegmentIndex(url.pathname);
  const basePath = trackerIndex >= 0 ? url.pathname.slice(0, trackerIndex) : url.pathname;
  const normalizedPath = basePath.replace(/\/+$/, "");

  return `${url.origin}${normalizedPath}`;
}

export function parseConnectionDeepLink(input: string): ParsedConnectionLink {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Unsupported Symphony connection link");
  }

  const route = url.hostname || url.pathname.replace(/^\/+/, "").split("/")[0];
  if (url.protocol !== "symphony:" || route !== "connect") {
    throw new Error("Unsupported Symphony connection link");
  }

  const trackerUrl = url.searchParams.get("url")?.trim();
  if (!trackerUrl) {
    throw new Error("Connection link must include a tracker URL");
  }

  const token = url.searchParams.get("token")?.trim();
  if (!token) {
    throw new Error("Connection link must include a tracker token");
  }

  return {
    origin: normalizeTrackerOrigin(trackerUrl),
    token,
  };
}

export function redactSecret(message: string, secret: string): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) return message;
  return message.split(normalizedSecret).join("[REDACTED]");
}

function trackerSegmentIndex(pathname: string): number {
  const index = pathname.indexOf(TRACKER_PATH_SEGMENT);
  if (index < 0) return -1;

  const nextCharacter = pathname[index + TRACKER_PATH_SEGMENT.length];
  return nextCharacter === undefined || nextCharacter === "/" ? index : -1;
}
