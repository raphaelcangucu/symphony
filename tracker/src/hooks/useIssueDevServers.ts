import { useCallback, useEffect, useRef, useState } from "react";

import { i18n } from "@/i18n";
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
  subscribeIssueDevServers,
} from "@/services/issueDevServers";
import type { IssueDevServersResponse } from "@/types/issue";

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
  const streamFailedRef = useRef(false);
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

      setError(i18n.t("issue.devServer.errors.loadFailed"));
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
        setError(i18n.t("issue.devServer.errors.identifiersRequired"));
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
        setError(i18n.t("issue.devServer.errors.identifiersRequired"));
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
    () => runAction(startIssueDevServers, i18n.t("issue.devServer.errors.startAllFailed")),
    [runAction],
  );
  const stop = useCallback(
    () => runAction(stopIssueDevServers, i18n.t("issue.devServer.errors.stopAllFailed")),
    [runAction],
  );
  const restart = useCallback(
    () => runAction(restartIssueDevServers, i18n.t("issue.devServer.errors.restartAllFailed")),
    [runAction],
  );
  const startServer = useCallback(
    (serverId: number) =>
      runInstanceAction(startIssueDevServer, serverId, i18n.t("issue.devServer.errors.startFailed")),
    [runInstanceAction],
  );
  const stopServer = useCallback(
    (serverId: number) =>
      runInstanceAction(stopIssueDevServer, serverId, i18n.t("issue.devServer.errors.stopFailed")),
    [runInstanceAction],
  );
  const restartServer = useCallback(
    (serverId: number) =>
      runInstanceAction(restartIssueDevServer, serverId, i18n.t("issue.devServer.errors.restartFailed")),
    [runInstanceAction],
  );

  const startTunnel = useCallback(async () => {
    try {
      const tunnel = await startPublicTunnel();
      setData((current) => (current ? { ...current, tunnel } : current));
      setError(null);
    } catch {
      setError(i18n.t("issue.devServer.errors.tunnelFailed"));
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
    streamFailedRef.current = false;

    if (!hasIdentifiers || !projectSlug || !issueIdentifier) {
      setData(null);
      setError(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    const unsubscribe = subscribeIssueDevServers(projectSlug, issueIdentifier, {
      onSnapshot: (response) => {
        setData(response);
        setError(null);
        hasLoadedRef.current = true;
        setLoading(false);
      },
      onUpdate: (response) => {
        setData(response);
        setError(null);
      },
      onError: () => {
        if (streamFailedRef.current) {
          return;
        }

        streamFailedRef.current = true;
        void refresh();
      },
    });

    return () => {
      requestIdRef.current += 1;
      inFlightRef.current = false;
      actionGenerationRef.current += 1;
      actionInFlightRef.current = false;
      unsubscribe();
    };
  }, [hasIdentifiers, issueIdentifier, projectSlug, refresh]);

  useEffect(() => {
    if (!hasIdentifiers || !focused) return;
    void refresh();
  }, [focused, hasIdentifiers, refresh]);

  return { data, loading, error, refresh, start, stop, restart, startServer, stopServer, restartServer, startTunnel };
}

function hasRequiredIdentifier(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
