import { useLocalSearchParams } from "expo-router";

import { ConnectionGate } from "@/features/connect/ConnectionGate";
import { DiffRoute } from "@/features/source-control/DiffRoute";
import { HostDiffRoute } from "@/features/source-control/HostDiffRoute";

export default function DiffPage() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>();
  const hostId = Array.isArray(params.hostId) ? params.hostId[0] : params.hostId;

  if (hostId) return <HostDiffRoute />;
  return (
    <ConnectionGate>
      <DiffRoute />
    </ConnectionGate>
  );
}
