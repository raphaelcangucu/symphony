import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { createTrackerSocket } from "@/services/phoenix/socket";
import { openTerminalSession, terminalTopic } from "@/services/terminal";

interface IssueTerminalProps {
  projectSlug: string;
  issueIdentifier: string;
}

export function IssueTerminal({ projectSlug, issueIdentifier }: IssueTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const project = projectSlug.trim();
    const identifier = issueIdentifier.trim();
    const container = containerRef.current;
    if (!project || !identifier || !container) return undefined;

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

    openTerminalSession(project, identifier)
      .then((session) => {
        if (cancelled) return;

        channel = socket.channel(session.channelTopic || terminalTopic(project, identifier), { project_slug: project });

        channel.on("output", (payload) => {
          const data = payloadValue(payload, "data");
          if (typeof data === "string") renderSnapshot(terminal, data);
        });
        channel.on("error", (payload) => {
          const message = payloadValue(payload, "message");
          setError(typeof message === "string" ? message : "Terminal error");
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
            if (typeof output === "string" && output.length > 0) renderSnapshot(terminal, output);
          })
          .receive("error", (reason) => {
            setError(`Failed to join terminal channel: ${JSON.stringify(reason)}`);
          })
          .receive("timeout", () => {
            setError("Timed out joining terminal channel");
          });
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Failed to open terminal session");
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
    <div className="space-y-2">
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <div
        aria-label={`Terminal for ${issueIdentifier}`}
        className="h-[480px] overflow-hidden rounded-lg border bg-slate-950 p-2"
        ref={containerRef}
      />
    </div>
  );
}

function payloadValue(payload: unknown, key: string): unknown {
  if (typeof payload !== "object" || payload === null) return undefined;
  return (payload as Record<string, unknown>)[key];
}

function renderSnapshot(terminal: Terminal, output: string): void {
  terminal.reset();
  terminal.write(output);
}
