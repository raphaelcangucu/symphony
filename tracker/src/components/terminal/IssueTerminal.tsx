import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { createTrackerSocket } from "@/services/phoenix/socket";
import { openTerminalSession, projectTerminalTopic, terminalTopic } from "@/services/terminal";

interface IssueTerminalProps {
  projectSlug: string;
  issueIdentifier: string;
}

interface ProjectTerminalProps {
  projectSlug: string;
  className?: string;
}

export function IssueTerminal({ projectSlug, issueIdentifier }: IssueTerminalProps) {
  return (
    <TerminalSessionView
      projectSlug={projectSlug}
      issueIdentifier={issueIdentifier}
      ariaLabel={i18n.t("issue.terminal.ariaLabel", { identifier: issueIdentifier })}
    />
  );
}

export function ProjectTerminal({ projectSlug, className }: ProjectTerminalProps) {
  return (
    <TerminalSessionView
      projectSlug={projectSlug}
      ariaLabel={i18n.t("issue.terminal.projectAriaLabel", { projectSlug })}
      className={className}
      fillHeight
    />
  );
}

interface TerminalSessionViewProps {
  projectSlug: string;
  issueIdentifier?: string;
  ariaLabel: string;
  className?: string;
  fillHeight?: boolean;
}

function TerminalSessionView({
  projectSlug,
  issueIdentifier,
  ariaLabel,
  className,
  fillHeight = false,
}: TerminalSessionViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const project = projectSlug.trim();
    const identifier = issueIdentifier?.trim() ?? "";
    const container = containerRef.current;
    const projectScoped = issueIdentifier == null;
    if (!project || (!projectScoped && !identifier) || !container) return undefined;

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
    let channel: ReturnType<typeof socket.channel> | null = null;
    let cancelled = false;
    let lastSnapshot = "";
    const fallbackTopic = projectScoped ? projectTerminalTopic(project) : terminalTopic(project, identifier);

    const topicPromise = projectScoped
      ? Promise.resolve(fallbackTopic)
      : openTerminalSession(project, identifier).then((session) => session.channelTopic || fallbackTopic);

    topicPromise
      .then((channelTopic) => {
        if (cancelled) return;

        channel = socket.channel(channelTopic, { project_slug: project });

        channel.on("output", (payload) => {
          const data = payloadValue(payload, "data");
          if (typeof data === "string") lastSnapshot = renderSnapshot(terminal, data, lastSnapshot);
        });
        channel.on("error", (payload) => {
          const message = payloadValue(payload, "message");
          setError(typeof message === "string" ? message : i18n.t("issue.terminal.error"));
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
            const session = payloadValue(payload, "session");
            const output = payloadValue(session, "output");
            if (typeof output === "string" && output.length > 0) {
              lastSnapshot = renderSnapshot(terminal, output, lastSnapshot);
            }
            channel?.push("resize", { cols: terminal.cols, rows: terminal.rows });
          })
          .receive("error", (reason) => {
            setError(i18n.t("issue.terminal.joinFailed", { reason: JSON.stringify(reason) }));
          })
          .receive("timeout", () => {
            setError(i18n.t("issue.terminal.joinTimeout"));
          });
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : i18n.t("issue.terminal.openFailed"));
      });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            fitAddon.fit();
          });
    resizeObserver?.observe(container);

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      channel?.leave();
      socket.disconnect();
      terminal.dispose();
    };
  }, [issueIdentifier, projectSlug]);

  return (
    <div className={cn("space-y-2", fillHeight && "flex h-full min-h-0 flex-col", className)}>
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <div
        aria-label={ariaLabel}
        className={cn(
          "overflow-hidden rounded-lg border bg-slate-950 p-2",
          fillHeight ? "min-h-[480px] flex-1" : "h-[480px]",
        )}
        ref={containerRef}
      />
    </div>
  );
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
