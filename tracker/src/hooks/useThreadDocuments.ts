import { useEffect, useRef, useState } from "react";

import { useWindowFocus } from "@/hooks/useWindowFocus";
import { listThreadDocuments } from "@/services/threadDocuments";
import type { ThreadDocument } from "@/types/threadDocument";

const DEFAULT_INTERVAL_MS = 20_000;

interface UseThreadDocumentsArgs {
  threadId: number;
  enabled?: boolean;
  refreshKey?: number;
  intervalMs?: number;
}

export interface UseThreadDocumentsResult {
  documents: ThreadDocument[];
  available: boolean;
  reason: string | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useThreadDocuments({
  threadId,
  enabled = true,
  refreshKey = 0,
  intervalMs = DEFAULT_INTERVAL_MS,
}: UseThreadDocumentsArgs): UseThreadDocumentsResult {
  const [documents, setDocuments] = useState<ThreadDocument[]>([]);
  const [available, setAvailable] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(false);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const focused = useWindowFocus();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const active = enabled && Number.isInteger(threadId) && threadId > 0;

  const refetch = async () => {
    if (!mountedRef.current || !active || inFlightRef.current) return;

    inFlightRef.current = true;
    if (!hasLoadedRef.current) setLoading(true);

    try {
      const response = await listThreadDocuments(threadId);
      if (!mountedRef.current) return;

      setDocuments(response.documents);
      setAvailable(response.available);
      setReason(response.reason);
      hasLoadedRef.current = true;
    } catch {
      if (!mountedRef.current) return;
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      hasLoadedRef.current = false;
      setDocuments([]);
      setAvailable(false);
      setReason(null);
      setLoading(false);
      return undefined;
    }

    void refetch();

    const timer = setInterval(() => {
      if (focusedRef.current) void refetch();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [active, intervalMs, refreshKey, threadId]);

  return { documents, available, reason, loading, refetch };
}
