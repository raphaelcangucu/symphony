import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { diagnosticLog, type DiagnosticEntry } from "@/diagnostics/diagnostic-log";

import { DiagnosticsScreen } from "./DiagnosticsScreen";

export function DiagnosticsRoute() {
  const router = useRouter();
  const client = useTrackerClient();
  const [entries, setEntries] = useState<DiagnosticEntry[]>(() => diagnosticLog.list());
  const [state, setState] = useState<"live" | "offline" | "reconnecting">(
    client ? "reconnecting" : "offline",
  );

  useEffect(() => {
    const subscription = diagnosticLog.subscribe(() => setEntries(diagnosticLog.list()));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!client) {
      setState("offline");
      return;
    }
    void reconnect();
  }, [client]);

  async function reconnect() {
    if (!client) {
      setState("offline");
      return;
    }
    setState("reconnecting");
    diagnosticLog.record({
      scope: "system",
      event: "connection reconnecting",
      details: {},
    });
    try {
      await client.health();
      await client.viewer();
      setState("live");
      diagnosticLog.record({
        scope: "system",
        event: "connection live",
        details: {},
      });
    } catch (cause) {
      setState("offline");
      diagnosticLog.record({
        scope: "system",
        event: "connection offline",
        details: {
          error: cause instanceof Error ? cause.message : "Connection failed",
        },
      });
    }
  }

  return (
    <DiagnosticsScreen
      connectionState={state}
      entries={entries}
      onBack={() => router.back()}
      onClear={() => diagnosticLog.clear()}
      onReconnect={() => void reconnect()}
    />
  );
}
