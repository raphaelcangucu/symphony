import type { AssistantToolCall } from "@/services/assistant";

export type ToolCallProposalTab = "mixed" | "bash" | "mcp" | "extras";

export interface ToolCallProposalFixture {
  id: string;
  label: string;
  durationMs: number;
  calls: AssistantToolCall[];
}

const EMPTY_RESULT = {} as AssistantToolCall["result"];

function call(
  partial: Omit<AssistantToolCall, "result"> & { result?: AssistantToolCall["result"] },
): AssistantToolCall {
  return { result: EMPTY_RESULT, ...partial };
}

export const TOOL_CALL_PROPOSAL_FIXTURES: Record<ToolCallProposalTab, ToolCallProposalFixture> = {
  mixed: {
    id: "mixed",
    label: "Mixed · CDE-1180",
    durationMs: 103_000,
    calls: [
      call({
        id: "mixed-health-wait",
        name: "Bash",
        status: "running",
        arguments: {
          description: "Wait for preview health endpoint",
          command:
            "for i in $(seq 1 60); do curl -sf http://127.0.0.1:4301/health >/dev/null && echo ok && break; sleep 3; done",
        },
      }),
      call({
        id: "mixed-manage-preview",
        name: "Mcp",
        status: "complete",
        arguments: {
          toolName: "manage_preview",
          args: { action: "status" },
        },
        output: JSON.stringify({
          success: {
            content: [
              {
                text: {
                  text: JSON.stringify({
                    data: {
                      servers: [{ url: "https://advising-cde-1180.example.cods.dev", status: "starting" }],
                    },
                  }),
                },
              },
            ],
          },
        }),
      }),
      call({
        id: "mixed-unit-tests",
        name: "Bash",
        status: "complete",
        arguments: {
          description: "Run GranteeAutocomplete unit tests",
          command:
            "cd accessible-ui && yarn test GranteeAutocomplete.test.js | tee /tmp/grantee-test.log",
        },
        output: JSON.stringify({
          exitCode: 0,
          stdout: "PASS GranteeAutocomplete.test.js\nTests: 4 passed, 4 total\nDone in 3.35s.",
        }),
      }),
      call({
        id: "mixed-set-status",
        name: "Mcp",
        status: "complete",
        arguments: {
          toolName: "set_issue_status",
          args: { issue_id: "CDE-1180", status: "Em andamento" },
        },
        output: JSON.stringify({ success: { issue_id: "CDE-1180", status: "Em andamento" } }),
      }),
    ],
  },
  bash: {
    id: "bash",
    label: "Bash",
    durationMs: 45_000,
    calls: [
      call({
        id: "bash-tenant-db",
        name: "Bash",
        status: "complete",
        arguments: {
          description: "Ensure illume tenant DB exists",
          command: "bash scripts/ensure-tenant-db.sh illume | tee /tmp/tenant-db.log | tail -20",
        },
        output: JSON.stringify({
          exitCode: 0,
          executionTime: 8287,
          stdout: ">> WARNING No users found...\n>> ERRORS No users found with role: Director",
        }),
      }),
      call({
        id: "bash-pr-list",
        name: "Bash",
        status: "complete",
        arguments: {
          description: "Check if PR exists for branch",
          command: "gh pr list --head CDE-1180-grantee-autocomplete --json number,url,state",
        },
        output: JSON.stringify([
          { number: 9918, url: "https://github.com/example/repo/pull/9918", state: "OPEN" },
        ]),
      }),
    ],
  },
  mcp: {
    id: "mcp",
    label: "MCP",
    durationMs: 72_000,
    calls: [
      call({
        id: "mcp-preview-start",
        name: "Mcp",
        status: "complete",
        arguments: {
          toolName: "manage_preview",
          args: { action: "start", issue_id: "CDE-1180" },
        },
        output: JSON.stringify({
          success: {
            content: [
              {
                text: {
                  text: JSON.stringify({
                    data: {
                      servers: [{ url: "https://advising-cde-1180.example.cods.dev", status: "starting" }],
                    },
                  }),
                },
              },
            ],
          },
        }),
      }),
      call({
        id: "mcp-evidence",
        name: "Mcp",
        status: "complete",
        arguments: { toolName: "get_evidence_status", args: {} },
        output: JSON.stringify({
          success: { gateSatisfied: true, violations: [] },
        }),
      }),
      call({
        id: "mcp-acceptance",
        name: "Mcp",
        status: "error",
        arguments: { toolName: "update_acceptance_criteria", args: { issue_id: "CDE-1180" } },
        output: JSON.stringify({
          error: "Acceptance criteria section with checkboxes not found",
        }),
      }),
      call({
        id: "mcp-list-comments",
        name: "Mcp",
        status: "complete",
        arguments: { toolName: "list_comments", args: { issue_id: "CDE-1180" } },
        output: JSON.stringify({ success: { comments: [{ id: "c1", body: "Started work" }] } }),
      }),
    ],
  },
  extras: {
    id: "extras",
    label: "KB · DevEnv · Tunnel",
    durationMs: 58_000,
    calls: [
      call({
        id: "extras-kb-search",
        name: "Mcp",
        status: "complete",
        arguments: {
          toolName: "kb_search_pages",
          args: { query: "advisor groups placeholder", project_slug: "advising" },
        },
        output: JSON.stringify({ success: { pages: [{ path: "docs/advisor-groups.md", title: "Advisor groups" }] } }),
      }),
      call({
        id: "extras-kb-create",
        name: "Mcp",
        status: "complete",
        arguments: {
          toolName: "kb_create_page",
          args: {
            repository: "advising",
            path: "superpowers/specs/2026-07-16-cde-1180.md",
            title: "CDE-1180 design",
          },
        },
      }),
      call({
        id: "extras-kb-link",
        name: "Mcp",
        status: "complete",
        arguments: {
          toolName: "kb_link_task",
          args: { path: "superpowers/specs/2026-07-16-cde-1180.md", issue_id: "CDE-1180" },
        },
      }),
      call({
        id: "extras-kb-delete",
        name: "Mcp",
        status: "complete",
        arguments: {
          toolName: "kb_delete_page",
          args: { path: "superpowers/specs/draft.md" },
        },
      }),
      call({
        id: "extras-dev-env",
        name: "Mcp",
        status: "complete",
        arguments: { toolName: "manage_dev_env", args: { action: "warm_up" } },
        output: JSON.stringify({
          success: {
            content: [
              {
                text: {
                  text: JSON.stringify({
                    data: { status: "succeeded", port: 4399, run_id: 1 },
                  }),
                },
              },
            ],
          },
        }),
      }),
      call({
        id: "extras-tunnel",
        name: "Mcp",
        status: "running",
        arguments: { toolName: "manage_tunnel", args: { action: "start" } },
        output: JSON.stringify({ success: { running: true, public_url: "https://tunnel.example.dev" } }),
      }),
    ],
  },
};

export const TOOL_CALL_PROPOSAL_TABS: readonly ToolCallProposalTab[] = [
  "mixed",
  "bash",
  "mcp",
  "extras",
];
