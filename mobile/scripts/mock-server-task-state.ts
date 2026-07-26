type MockTaskRequest = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

const MOCK_TASKS = [
  {
    id: "101",
    identifier: "DEV-101",
    title: "Connect the copied Dev10x mobile experience",
    description:
      "Use the Symphony RPC host without changing the copied mobile interaction model.",
    projectSlug: "symphony",
    projectName: "Dev10x Symphony",
    status: "In Progress",
    updatedAt: "2026-07-25T21:00:00Z",
    agent: "codex",
    agentState: "live",
    blockedBy: ["DEV-99"],
    subtaskCount: 2,
    pendingApproval: true,
    pendingQuestion: false,
    url: null,
  },
  {
    id: "102",
    identifier: "DEV-102",
    title: "Capture Android E2E evidence",
    description: "Record the real local Symphony-host workflow.",
    projectSlug: "symphony",
    projectName: "Dev10x Symphony",
    status: "Todo",
    updatedAt: "2026-07-25T20:30:00Z",
    agent: "codex",
    agentState: "idle",
    blockedBy: [],
    subtaskCount: 0,
    pendingApproval: false,
    pendingQuestion: false,
    url: null,
  },
];

export function handleMockTaskRequest<Response>(
  request: MockTaskRequest,
  respond: (response: Response) => void,
  success: (id: string, result: unknown) => Response
): boolean {
  switch (request.method) {
    case "symphony.tasks.list": {
      const query = String(request.params.query ?? "")
        .trim()
        .toLowerCase();
      const items = query
        ? MOCK_TASKS.filter((item) =>
            `${item.identifier} ${item.title} ${item.projectName}`
              .toLowerCase()
              .includes(query)
          )
        : MOCK_TASKS;
      respond(
        success(request.id, {
          provider: "symphony",
          items,
          totalCount: items.length,
        })
      );
      return true;
    }

    case "symphony.tasks.get": {
      const identifier = String(request.params.identifier ?? "");
      const item = MOCK_TASKS.find(
        (candidate) => candidate.identifier === identifier
      );
      respond(
        success(request.id, {
          ...(item ?? MOCK_TASKS[0]),
          comments: [
            {
              id: "comment-1",
              author: "Dev10x",
              body: "The selected Symphony host owns this task.",
              createdAt: "2026-07-25T21:02:00Z",
            },
          ],
          blockers: [{ identifier: "DEV-99", title: "Encrypted RPC contract" }],
          subtasks: [
            { identifier: "DEV-103", title: "Android evidence" },
            { identifier: "DEV-104", title: "iOS handoff" },
          ],
        })
      );
      return true;
    }

    case "notifications.unsubscribe":
      respond(
        success(request.id, {
          unsubscribed: true,
          subscriptionId: String(request.params.subscriptionId ?? ""),
        })
      );
      return true;

    default:
      return false;
  }
}
