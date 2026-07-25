import * as ExpoCrypto from "expo-crypto";

export async function hostPublicKeyFingerprint(hostPublicKey: string): Promise<string> {
  const digest = await ExpoCrypto.digestStringAsync(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    hostPublicKey,
  );
  return `sha256:${digest}`;
}
