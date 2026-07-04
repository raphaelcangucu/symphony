import axios from "axios";

import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { CreateTerminalTabInput, TerminalTab } from "@/types/terminal";

import { http, trackerPath, unwrapData } from "./http";

interface BackendTerminalTabDto {
  id: string;
  project_slug: string;
  issue_identifier: string;
  title: string;
  cwd: string | null;
  command: string | null;
  state: TerminalTab["state"];
  session_name: string | null;
  channel_topic: string;
  output?: string;
}

export class TerminalTabsApiUnavailableError extends Error {
  constructor() {
    super("terminal_tabs_api_unavailable");
    this.name = "TerminalTabsApiUnavailableError";
  }
}

function tabsPath(projectSlug: string, issueIdentifier: string): string {
  const slug = requireProjectSlug(projectSlug);
  const identifier = requireNonBlank(issueIdentifier, "issueIdentifier");
  return trackerPath(
    `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(identifier)}/terminal-tabs`,
  );
}

export function terminalTabTopic(projectSlug: string, tabId: string): string {
  const slug = requireProjectSlug(projectSlug);
  const id = requireNonBlank(tabId, "tabId");
  return `terminal:tab:${slug}:${id}`;
}

function isApiUnavailable(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

export async function listTerminalTabs(projectSlug: string, issueIdentifier: string): Promise<TerminalTab[]> {
  try {
    const response = await http.get(tabsPath(projectSlug, issueIdentifier));
    const rows = unwrapData<BackendTerminalTabDto[]>(response);
    return rows.map(normalizeTerminalTab);
  } catch (error) {
    if (isApiUnavailable(error)) throw new TerminalTabsApiUnavailableError();
    throw error;
  }
}

export async function createTerminalTab(
  projectSlug: string,
  issueIdentifier: string,
  input: CreateTerminalTabInput = {},
): Promise<TerminalTab> {
  try {
    const response = await http.post(tabsPath(projectSlug, issueIdentifier), input);
    return normalizeTerminalTab(unwrapData<BackendTerminalTabDto>(response));
  } catch (error) {
    if (isApiUnavailable(error)) throw new TerminalTabsApiUnavailableError();
    throw error;
  }
}

export async function renameTerminalTab(
  projectSlug: string,
  issueIdentifier: string,
  tabId: string,
  title: string,
): Promise<TerminalTab> {
  const slug = requireProjectSlug(projectSlug);
  const identifier = requireNonBlank(issueIdentifier, "issueIdentifier");
  const id = requireNonBlank(tabId, "tabId");

  try {
    const response = await http.patch(
      trackerPath(
        `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(identifier)}/terminal-tabs/${encodeURIComponent(id)}`,
      ),
      { title },
    );

    return normalizeTerminalTab(unwrapData<BackendTerminalTabDto>(response));
  } catch (error) {
    if (isApiUnavailable(error)) throw new TerminalTabsApiUnavailableError();
    throw error;
  }
}

export async function closeTerminalTab(
  projectSlug: string,
  issueIdentifier: string,
  tabId: string,
): Promise<void> {
  const slug = requireProjectSlug(projectSlug);
  const identifier = requireNonBlank(issueIdentifier, "issueIdentifier");
  const id = requireNonBlank(tabId, "tabId");

  try {
    await http.delete(
      trackerPath(
        `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(identifier)}/terminal-tabs/${encodeURIComponent(id)}`,
      ),
    );
  } catch (error) {
    if (isApiUnavailable(error)) throw new TerminalTabsApiUnavailableError();
    throw error;
  }
}

function normalizeTerminalTab(tab: BackendTerminalTabDto): TerminalTab {
  return {
    id: tab.id,
    projectSlug: tab.project_slug,
    issueIdentifier: tab.issue_identifier,
    title: tab.title,
    cwd: tab.cwd,
    command: tab.command,
    state: tab.state,
    sessionName: tab.session_name,
    channelTopic: tab.channel_topic,
    output: tab.output,
  };
}
