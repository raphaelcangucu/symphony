import { parsePairingOffer } from "@/auth/pairing-offer";

import type { PairingOffer } from "./types";

export function decodePairingUrl(url: string): PairingOffer | null {
  try {
    return presentPairingOffer(parsePairingOffer(url));
  } catch {
    return null;
  }
}

export function extractPairingCodeFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (
      parsed.protocol !== "symphony:" ||
      parsed.hostname !== "pair" ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      [...parsed.searchParams.keys()].some((key) => key !== "code") ||
      parsed.searchParams.size !== 1
    ) {
      return null;
    }
    return parsed.searchParams.get("code");
  } catch {
    return null;
  }
}

export function parsePairingCode(input: string): PairingOffer | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const link = /^symphony:\/\//i.test(trimmed)
    ? trimmed
    : `symphony://pair?code=${encodeURIComponent(trimmed)}`;
  return decodePairingUrl(link);
}

function presentPairingOffer(offer: ReturnType<typeof parsePairingOffer>): PairingOffer {
  return {
    ...offer,
    publicKeyB64: offer.hostPublicKey,
  };
}
