import type { Channel } from "phoenix";
import { useEffect, useMemo, useRef, useState } from "react";

import { createTrackerSocket } from "@/services/phoenix/socket";

export interface UsePhoenixChannelArgs {
  /** Channel topic; pass null to keep the socket disconnected. */
  topic: string | null;
  /** Join params. Compared by value (JSON), so inline objects are fine. */
  params?: Record<string, unknown>;
  /** Bind channel events here; runs after channel creation, before join. */
  onSetup?: (channel: Channel) => void;
  onJoin?: (payload: unknown) => void;
  onJoinError?: (reason: unknown) => void;
  onJoinTimeout?: () => void;
}

export interface UsePhoenixChannelResult {
  channel: Channel | null;
  connected: boolean;
}

/**
 * Owns the socket-connect → channel-join → leave/disconnect lifecycle that was
 * previously re-implemented by every realtime hook (project events, session
 * log, observability, assistant, terminal). Callbacks are held in refs, so
 * consumers don't need to memoize them and updates never force a reconnect.
 */
export function usePhoenixChannel({
  topic,
  params,
  onSetup,
  onJoin,
  onJoinError,
  onJoinTimeout,
}: UsePhoenixChannelArgs): UsePhoenixChannelResult {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [connected, setConnected] = useState(false);

  const callbacksRef = useRef({ onSetup, onJoin, onJoinError, onJoinTimeout });
  callbacksRef.current = { onSetup, onJoin, onJoinError, onJoinTimeout };

  const paramsKey = params ? JSON.stringify(params) : null;
  const stableParams = useMemo(
    () => (paramsKey ? (JSON.parse(paramsKey) as Record<string, unknown>) : undefined),
    [paramsKey],
  );

  useEffect(() => {
    if (!topic) {
      setChannel(null);
      setConnected(false);
      return undefined;
    }

    const socket = createTrackerSocket();
    socket.connect();

    const nextChannel = socket.channel(topic, stableParams);
    let cancelled = false;

    callbacksRef.current.onSetup?.(nextChannel);
    setChannel(nextChannel);

    nextChannel
      .join()
      .receive("ok", (payload) => {
        if (cancelled) return;
        setConnected(true);
        callbacksRef.current.onJoin?.(payload);
      })
      .receive("error", (reason) => {
        if (cancelled) return;
        setConnected(false);
        callbacksRef.current.onJoinError?.(reason);
      })
      .receive("timeout", () => {
        if (cancelled) return;
        setConnected(false);
        callbacksRef.current.onJoinTimeout?.();
      });

    return () => {
      cancelled = true;
      setChannel(null);
      setConnected(false);
      nextChannel.leave();
      socket.disconnect();
    };
  }, [topic, stableParams]);

  return { channel, connected };
}
