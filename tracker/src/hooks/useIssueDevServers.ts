import { useCallback, useEffect, useRef, useState } from "react";

import { useWindowFocus } from "@/hooks/useWindowFocus";
import {
  fetchIssueDevServers,
  restartIssueDevServer,
  restartIssueDevServers,
  startIssueDevServer,
  startIssueDevServers,
  startPublicTunnel,
  stopIssueDevServer,
  stopIssueDevServers,
} from "@/services/issueDevServers";
import type { IssueDevServersResponse, IssueDevServerStatus } from "@/types/issue";

const POLL_INTERVAL_MS = 2_000;
const TRANSIENT_STATUSES = new Set<IssueDevServerStatus>(["pending", "provisioning", "starting"]);

export interface UseIssueDevServersResult {
  data: IssueDevServersResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  startServer: (serverId: number) => Promise<void>;
  stopServer: (serverId: number) => Promise<void>;
  restartServer: (serverId: number) => Promise<void>;
  startTunnel: () => Promise<void>;
}

type IssueDevServerAction = (
  projectSlug: string,
  issueIdentifier: string,
) => Promise<IssueDevServersResponse>;

type IssueDevServerInstanceAction = (
  projectSlug: string,
  issueIdentifier: string,
  serverId: number,
) => Promise<IssueDevServersResponse>;

export function useIssueDevServers(
  projectSlug: string | null | undefined,
  issueIdentifier: string | null | undefined,
): UseIssueDevServersResult {
  const [data, setData] = useState<IssueDevServersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const actionInFlightRef = useRef(false);
  const actionGenerationRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const focused = useWindowFocus();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const hasIdentifiers = hasRequiredIdentifier(projectSlug) && hasRequiredIdentifier(issueIdentifier);

  const refresh = useCallback(async () => {
    if (!hasIdentifiers || !projectSlug || !issueIdentifier) {
      return;
    }

    if (inFlightRef.current) {
      return;
    }

    const requestId = ++requestIdRef.current;
    inFlightRef.current = true;

    if (!hasLoadedRef.current) {
      setLoading(true);
    }

    try {
      const response = await fetchIssueDevServers(projectSlug, issueIdentifier);

      if (requestId !== requestIdRef.current) {
        return;
      }

      setData(response);
      setError(null);
      hasLoadedRef.current = true;
    } catch {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setError("Could not load issue dev servers.");
    } finally {
      if (requestId === requestIdRef.current) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [hasIdentifiers, issueIdentifier, projectSlug]);

  const runAction = useCallback(
    async (action: IssueDevServerAction, failureMessage: string) => {
      if (!hasIdentifiers || !projectSlug || !issueIdentifier) {
        setError("Project and issue identifiers are required.");
        return;
      }

      if (actionInFlightRef.current) {
        return;
      }

      actionInFlightRef.current = true;
      const actionGeneration = actionGenerationRef.current;
      const requestId = ++requestIdRef.current;
      inFlightRef.current = true;
      setLoading(true);

      try {
        const response = await action(projectSlug, issueIdentifier);

        if (requestId !== requestIdRef.current) {
          return;
        }

        setData(response);
        setError(null);
        hasLoadedRef.current = true;
      } catch {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setError(failureMessage);
      } finally {
        if (actionGeneration === actionGenerationRef.current) {
          actionInFlightRef.current = false;
        }

        if (requestId === requestIdRef.current) {
          inFlightRef.current = false;
          setLoading(false);
        }
      }
    },
    [hasIdentifiers, issueIdentifier, projectSlug],
  );

  const runInstanceAction = useCallback(
    async (action: IssueDevServerInstanceAction, serverId: number, failureMessage: string) => {
      if (!hasIdentifiers || !projectSlug || !issueIdentifier) {
        setError("Project and issue identifiers are required.");
        return;
      }

      if (actionInFlightRef.current) {
        return;
      }

      actionInFlightRef.current = true;
      const actionGeneration = actionGenerationRef.current;
      const requestId = ++requestIdRef.current;
      inFlightRef.current = true;
      setLoading(true);

      try {
        const response = await action(projectSlug, issueIdentifier, serverId);

        if (requestId !== requestIdRef.current) {
          return;
        }

        setData(response);
        setError(null);
        hasLoadedRef.current = true;
      } catch {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setError(failureMessage);
      } finally {
        if (actionGeneration === actionGenerationRef.current) {
          actionInFlightRef.current = false;
        }

        if (requestId === requestIdRef.current) {
          inFlightRef.current = false;
          setLoading(false);
        }
      }
    },
    [hasIdentifiers, issueIdentifier, projectSlug],
  );

  const start = useCallback(
    () => runAction(startIssueDevServers, "Could not start issue dev servers."),
    [runAction],
  );
  const stop = useCallback(
    () => runAction(stopIssueDevServers, "Could not stop issue dev servers."),
    [runAction],
  );
  const restart = useCallback(
    () => runAction(restartIssueDevServers, "Could not restart issue dev servers."),
    [runAction],
  );
  const startServer = useCallback(
    (serverId: number) =>
      runInstanceAction(startIssueDevServer, serverId, "Could not start the dev server."),
    [runInstanceAction],
  );
  const stopServer = useCallback(
    (serverId: number) =>
      runInstanceAction(stopIssueDevServer, serverId, "Could not stop the dev server."),
    [runInstanceAction],
  );
  const restartServer = useCallback(
    (serverId: number) =>
      runInstanceAction(restartIssueDevServer, serverId, "Could not restart the dev server."),
    [runInstanceAction],
  );

  const startTunnel = useCallback(async () => {
    try {
      const tunnel = await startPublicTunnel();
      setData((current) => (current ? { ...current, tunnel } : current));
      setError(null);
    } catch {
      setError("Could not start the Cloudflare tunnel.");
    } finally {
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    requestIdRef.current += 1;
    hasLoadedRef.current = false;
    inFlightRef.current = false;
    actionGenerationRef.current += 1;
    actionInFlightRef.current = false;

    if (!hasIdentifiers) {
      setData(null);
      setError(null);
      setLoading(false);
      return undefined;
    }

    void refresh();

    return () => {
      requestIdRef.current += 1;
      inFlightRef.current = false;
      actionGenerationRef.current += 1;
      actionInFlightRef.current = false;
    };
  }, [hasIdentifiers, refresh]);

  useEffect(() => {
    if (!hasIdentifiers || !shouldPoll(data)) {
      return undefined;
    }

    const timer = setInterval(() => {
      if (focusedRef.current) void refresh();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [data, hasIdentifiers, refresh]);

  useEffect(() => {
    if (!hasIdentifiers || !focused) return;
    void refresh();
  }, [focused, hasIdentifiers, refresh]);

  return { data, loading, error, refresh, start, stop, restart, startServer, stopServer, restartServer, startTunnel };
}

function hasRequiredIdentifier(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function shouldPoll(data: IssueDevServersResponse | null): boolean {
  if (!data) {
    return false;
  }

  return data.servers.some((server) => TRANSIENT_STATUSES.has(server.status));
}
