import type { HostTransport } from "@/transport/HostTransport";

import { normalizeEvidenceRecords, type EvidenceRecord } from "./evidence-contract";

export async function listTaskEvidence(
  transport: HostTransport,
  projectSlug: string,
  identifier: string,
  signal?: AbortSignal,
): Promise<EvidenceRecord[]> {
  const payload = await transport.call<unknown>(
    "evidence.list",
    {
      project_slug: projectSlug,
      identifier,
    },
    signal,
  );
  return normalizeEvidenceRecords(payload);
}
