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

export interface TerminalTab {
  id: string;
  projectSlug: string;
  issueIdentifier: string;
  title: string;
  cwd: string | null;
  command: string | null;
  state: TerminalSessionState;
  sessionName: string | null;
  channelTopic: string;
  output?: string;
}

export interface CreateTerminalTabInput {
  title?: string;
  cwd?: string;
  command?: string;
}

export type TerminalClientEvent =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export type TerminalServerEvent =
  | { type: "output"; data: string }
  | { type: "state"; session: TerminalSession }
  | { type: "error"; message: string };
