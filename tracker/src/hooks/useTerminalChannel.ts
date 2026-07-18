import type { Channel } from "phoenix";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import { i18n } from "@/i18n";
import { createTrackerSocket } from "@/services/phoenix/socket";
import { openTerminalSession } from "@/services/terminal";
import { terminalTabTopic } from "@/services/terminalTabs";

export type TerminalConnectionKind = "issue" | "project-devenv" | "dynamic-tab" | "dev-server";

interface UseTerminalChannelArgs {
  kind: TerminalConnectionKind;
  projectSlug: string;
  issueIdentifier?: string;
  tabId?: string;
  serverSlug?: string;
  enabled?: boolean;
  onActivated?: () => void;
}

interface UseTerminalChannelResult {
  containerRef: RefObject<HTMLDivElement | null>;
  error: string | null;
  connected: boolean;
}

function payloadValue(payload: unknown, key: string): unknown {
  if (typeof payload !== "object" || payload === null) return undefined;
  return (payload as Record<string, unknown>)[key];
}

function renderSnapshot(terminal: Terminal, output: string, previous: string): string {
  if (output === previous) return previous;
  terminal.reset();
  terminal.write(output);
  return output;
}

export function useTerminalChannel({
  kind,
  projectSlug,
  issueIdentifier,
  tabId,
  serverSlug,
  enabled = true,
  onActivated,
}: UseTerminalChannelArgs): UseTerminalChannelResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const project = projectSlug.trim();
    const identifier = issueIdentifier?.trim() ?? "";
    const dynamicTabId = tabId?.trim() ?? "";
    const devServerSlug = serverSlug?.trim() ?? "";
    const container = containerRef.current;

    if (!enabled || !project || !container) {
      setConnected(false);
      setError(null);
      return undefined;
    }

    if (kind === "issue" && !identifier) {
      setConnected(false);
      setError(i18n.t("workspace.terminal.missingIssue"));
      return undefined;
    }

    if (kind === "dynamic-tab" && !dynamicTabId) {
      setConnected(false);
      setError(i18n.t("workspace.terminal.missingTab"));
      return undefined;
    }

    if (kind === "dev-server" && (!identifier || !devServerSlug)) {
      setConnected(false);
      setError(i18n.t("workspace.terminal.missingIssue"));
      return undefined;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#020617",
        foreground: "#e2e8f0",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();

    const socket = createTrackerSocket();
    socket.connect();
    let channel: Channel | null = null;
    let cancelled = false;
    let lastSnapshot = "";

    const joinChannel = (topic: string, joinParams: Record<string, string>) => {
      channel = socket.channel(topic, joinParams);

      channel.on("output", (payload) => {
        const data = payloadValue(payload, "data");
        if (typeof data === "string") lastSnapshot = renderSnapshot(terminal, data, lastSnapshot);
      });
      channel.on("error", (payload) => {
        const message = payloadValue(payload, "message");
        setError(typeof message === "string" ? message : i18n.t("issue.terminal.error"));
        setConnected(false);
      });

      terminal.onData((data) => {
        channel?.push("input", { data });
      });
      terminal.onResize(({ cols, rows }) => {
        channel?.push("resize", { cols, rows });
      });

      channel
        .join()
        .receive("ok", (payload) => {
          if (cancelled) return;
          setConnected(true);
          setError(null);
          const session = payloadValue(payload, "session");
          const output = payloadValue(session, "output");
          if (typeof output === "string" && output.length > 0) {
            lastSnapshot = renderSnapshot(terminal, output, lastSnapshot);
          }
          channel?.push("resize", { cols: terminal.cols, rows: terminal.rows });
          onActivated?.();
          fitAddon.fit();
        })
        .receive("error", (reason) => {
          if (cancelled) return;
          setConnected(false);
          setError(i18n.t("issue.terminal.joinFailed", { reason: JSON.stringify(reason) }));
        })
        .receive("timeout", () => {
          if (cancelled) return;
          setConnected(false);
          setError(i18n.t("issue.terminal.joinTimeout"));
        });
    };

    const bootstrap = async () => {
      try {
        if (kind === "issue") {
          const session = await openTerminalSession(project, identifier);
          if (cancelled) return;
          joinChannel(session.channelTopic, { project_slug: project });
          return;
        }

        if (kind === "dynamic-tab") {
          joinChannel(terminalTabTopic(project, dynamicTabId), {});
          return;
        }

        if (kind === "dev-server") {
          joinChannel(`terminal:dev:${project}:${identifier}:${devServerSlug}`, {});
          return;
        }

        joinChannel(`terminal:devenv:${project}`, {});
      } catch (reason: unknown) {
        if (cancelled) return;
        setConnected(false);
        setError(reason instanceof Error ? reason.message : i18n.t("issue.terminal.openFailed"));
      }
    };

    void bootstrap();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            fitAddon.fit();
            channel?.push("resize", { cols: terminal.cols, rows: terminal.rows });
          });
    resizeObserver?.observe(container);

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      channel?.leave();
      socket.disconnect();
      terminal.dispose();
      setConnected(false);
    };
  }, [enabled, issueIdentifier, kind, onActivated, projectSlug, serverSlug, tabId]);

  return { containerRef, error, connected };
}
