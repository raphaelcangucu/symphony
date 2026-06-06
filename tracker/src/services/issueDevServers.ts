import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import type { IssueDevServerTunnel, IssueDevServersResponse } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";

type IssueDevServerAction = "start" | "stop" | "restart";

const DEV_SERVERS_PATH_SEGMENT = "dev_servers";

export async function fetchIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  const response = await http.get(issueDevServersPath(projectSlug, issueIdentifier));

  return unwrapData<IssueDevServersResponse>(response);
}

export async function startIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerAction(projectSlug, issueIdentifier, "start");
}

export async function stopIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerAction(projectSlug, issueIdentifier, "stop");
}

export async function restartIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerAction(projectSlug, issueIdentifier, "restart");
}

export async function startIssueDevServer(
  projectSlug: string,
  issueIdentifier: string,
  serverId: number,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerInstanceAction(projectSlug, issueIdentifier, serverId, "start");
}

export async function stopIssueDevServer(
  projectSlug: string,
  issueIdentifier: string,
  serverId: number,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerInstanceAction(projectSlug, issueIdentifier, serverId, "stop");
}

export async function restartIssueDevServer(
  projectSlug: string,
  issueIdentifier: string,
  serverId: number,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerInstanceAction(projectSlug, issueIdentifier, serverId, "restart");
}

async function postIssueDevServerAction(
  projectSlug: string,
  issueIdentifier: string,
  action: IssueDevServerAction,
): Promise<IssueDevServersResponse> {
  const response = await http.post(`${issueDevServersPath(projectSlug, issueIdentifier)}/${action}`);

  return unwrapData<IssueDevServersResponse>(response);
}

async function postIssueDevServerInstanceAction(
  projectSlug: string,
  issueIdentifier: string,
  serverId: number,
  action: IssueDevServerAction,
): Promise<IssueDevServersResponse> {
  if (!Number.isInteger(serverId) || serverId <= 0) {
    throw new Error("serverId must be a positive integer");
  }

  const response = await http.post(
    `${issueDevServersPath(projectSlug, issueIdentifier)}/${encodeURIComponent(String(serverId))}/${action}`,
  );

  return unwrapData<IssueDevServersResponse>(response);
}

export async function startPublicTunnel(): Promise<IssueDevServerTunnel> {
  const response = await http.post(trackerPath("/tunnel/start"));

  return unwrapData<IssueDevServerTunnel>(response);
}

function issueDevServersPath(projectSlug: string, issueIdentifier: string): string {
  requireNonBlank(projectSlug, "projectSlug");
  const normalizedIssueIdentifier = normalizeIssueIdentifier(issueIdentifier);
  requireNonBlank(normalizedIssueIdentifier, "issueIdentifier");

  return trackerPath(
    `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(normalizedIssueIdentifier)}/${DEV_SERVERS_PATH_SEGMENT}`,
  );
}

function requireNonBlank(value: string, fieldName: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
}
