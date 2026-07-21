import {
  useIssueDevServers,
  type UseIssueDevServersResult,
} from "@/hooks/useIssueDevServers";

export type UseThreadDevServersResult = UseIssueDevServersResult;

export function useThreadDevServers(
  threadId: number | null | undefined,
): UseThreadDevServersResult {
  return useIssueDevServers(null, null, threadId);
}
