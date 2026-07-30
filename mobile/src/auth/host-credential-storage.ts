import type { SecureStorageAdapter } from "./connection-storage";

export type HostCredential = {
  deviceId: string;
  deviceToken: string;
  hostPublicKey: string;
};

const HOST_CREDENTIAL_PREFIX = "symphony.host.";

export function hostCredentialKey(profileId: string): string {
  return `${HOST_CREDENTIAL_PREFIX}${profileId}.credential`;
}

export async function loadHostCredential(
  storage: SecureStorageAdapter,
  profileId: string,
): Promise<HostCredential | null> {
  const raw = await storage.getItemAsync(hostCredentialKey(profileId));
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    return isHostCredential(value) ? value : null;
  } catch {
    return null;
  }
}

export async function saveHostCredential(
  storage: SecureStorageAdapter,
  profileId: string,
  credential: HostCredential,
): Promise<void> {
  if (!isHostCredential(credential)) throw new Error("Invalid mobile host credential");
  await storage.setItemAsync(hostCredentialKey(profileId), JSON.stringify(credential));
}

export async function removeHostCredential(
  storage: SecureStorageAdapter,
  profileId: string,
): Promise<void> {
  await storage.deleteItemAsync(hostCredentialKey(profileId));
}

function isHostCredential(value: unknown): value is HostCredential {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as HostCredential).deviceId === "string" &&
    (value as HostCredential).deviceId.trim() !== "" &&
    typeof (value as HostCredential).deviceToken === "string" &&
    (value as HostCredential).deviceToken.trim() !== "" &&
    typeof (value as HostCredential).hostPublicKey === "string" &&
    (value as HostCredential).hostPublicKey.trim() !== ""
  );
}
