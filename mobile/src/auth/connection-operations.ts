import type { TrackerClient } from "@/api/contracts";

import type { ConnectionProfile } from "./connection-profile";
import type { ConnectionStorage, ConnectionStorageSnapshot } from "./connection-storage";

export type TrackerClientFactory = (options: {
  origin: string;
  token: string;
  locale: string;
}) => TrackerClient;

export async function validateAndReplaceConnectionToken({
  createClient,
  locale,
  profile,
  storage,
  token,
}: {
  createClient: TrackerClientFactory;
  locale: string;
  profile: ConnectionProfile;
  storage: ConnectionStorage;
  token: string;
}): Promise<void> {
  const normalizedToken = requiredToken(token);
  const client = createClient({
    origin: profile.origin,
    token: normalizedToken,
    locale,
  });
  await client.health();
  await client.viewer();
  await storage.replaceToken(profile.id, normalizedToken);
}

export async function removeConnectionProfileWithCleanup({
  createClient,
  deviceId,
  locale,
  profileId,
  storage,
}: {
  createClient: TrackerClientFactory;
  deviceId(): Promise<string>;
  locale: string;
  profileId: string;
  storage: ConnectionStorage;
}): Promise<ConnectionStorageSnapshot> {
  const snapshot = await storage.loadSnapshot();
  const profile = snapshot.profiles.find((candidate) => candidate.id === profileId);
  const token = profile ? await storage.loadToken(profileId) : null;

  if (profile && token) {
    try {
      const client = createClient({ origin: profile.origin, token, locale });
      await client.unregisterMobilePush({
        profileId,
        deviceId: await deviceId(),
      });
    } catch {
      // Profile removal must remain recoverable even when the server is offline.
    }
  }

  return storage.removeProfile(profileId);
}

function requiredToken(token: string): string {
  const normalized = token.trim();
  if (!normalized) throw new Error("Connection token is required");
  return normalized;
}
