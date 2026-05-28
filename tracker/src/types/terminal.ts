export type TerminalSessionState = "missing" | "starting" | "running" | "stopped" | "error";

export interface TerminalSession {
  projectSlug: string;
  issueIdentifier: string;
  state: TerminalSessionState;
  sessionName: string | null;
  cwd: string | null;
  channelTopic: string;
  message?: string | null;
}

export type TerminalClientEvent =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export type TerminalServerEvent =
  | { type: "output"; data: string }
  | { type: "state"; session: TerminalSession }
  | { type: "error"; message: string };
