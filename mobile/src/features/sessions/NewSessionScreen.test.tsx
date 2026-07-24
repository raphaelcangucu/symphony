import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import type {
  AssistantCatalog,
  AssistantThread,
  CreateThreadInput,
  ProjectSummary,
} from "@/api/contracts";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { NewSessionScreen } from "./NewSessionScreen";
import { createInitialNewSessionState } from "./new-session-state";

const projects: ProjectSummary[] = [{ id: "project-1", slug: "symphony", name: "Symphony" }];
const createdThread: AssistantThread = {
  id: 42,
  scope: "freeform",
  projectSlug: null,
  projectName: null,
  issueIdentifier: null,
  workspacePath: null,
  title: null,
  status: "idle",
  preview: null,
  updatedAt: "2026-07-24T02:00:00Z",
  agentKind: "codex",
  needsReview: false,
};

function renderScreen(overrides: Partial<React.ComponentProps<typeof NewSessionScreen>> = {}) {
  const props: React.ComponentProps<typeof NewSessionScreen> = {
    connectionName: "Remote",
    projects,
    initialState: createInitialNewSessionState(),
    createThread: jest.fn().mockResolvedValue(createdThread),
    loadCatalog: jest.fn().mockResolvedValue({
      defaultAgent: "codex",
      agents: [],
    } satisfies AssistantCatalog),
    onBack: jest.fn(),
    onCreated: jest.fn(),
    onDraftChange: jest.fn(),
    onClearDraft: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return {
    ...render(
      <ThemeProvider colorScheme="dark">
        <NewSessionScreen {...props} />
      </ThemeProvider>,
    ),
    props,
  };
}

describe("NewSessionScreen", () => {
  it("opens as a focused composer with clean context summaries", () => {
    renderScreen();

    expect(screen.getByLabelText("Message")).toHaveProp("autoFocus", true);
    expect(screen.getByText("Remote")).toBeTruthy();
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.getByText("Default workspace")).toBeTruthy();
    expect(screen.getByText("No branch")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show advanced options" })).toBeTruthy();
    expect(screen.queryByText("Agent")).toBeNull();
    expect(screen.queryByLabelText("Session title")).toBeNull();
    expect(screen.queryByRole("button", { name: /attach/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /voice/i })).toBeNull();
  });

  it("creates the common freeform path from only a message and Send", async () => {
    const createThread = jest.fn().mockResolvedValue(createdThread);
    const onCreated = jest.fn();
    const onClearDraft = jest.fn().mockResolvedValue(undefined);
    renderScreen({ createThread, onCreated, onClearDraft });

    fireEvent.changeText(screen.getByLabelText("Message"), "Build the clean flow");
    fireEvent.press(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(createThread).toHaveBeenCalledWith({
        scope: "freeform",
        agentKind: "codex",
      } satisfies CreateThreadInput),
    );
    expect(onClearDraft).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(42, "Build the clean flow");
  });

  it("guards double taps while creating", () => {
    const createThread = jest.fn(() => new Promise<AssistantThread>(() => undefined));
    renderScreen({ createThread });

    fireEvent.changeText(screen.getByLabelText("Message"), "Only once");
    fireEvent.press(screen.getByRole("button", { name: "Send" }));
    fireEvent.press(screen.getByRole("button", { name: "Creating session" }));

    expect(createThread).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft and context after failure and supports Retry", async () => {
    const createThread = jest
      .fn()
      .mockRejectedValueOnce(new Error("Tracker offline"))
      .mockResolvedValueOnce(createdThread);
    renderScreen({ createThread });

    fireEvent.changeText(screen.getByLabelText("Message"), "Keep this draft");
    fireEvent.press(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tracker offline");
    expect(screen.getByLabelText("Message")).toHaveProp("value", "Keep this draft");

    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(createThread).toHaveBeenCalledTimes(2));
  });

  it("loads project catalog only after a project is selected", async () => {
    const loadCatalog = jest.fn().mockResolvedValue({
      defaultAgent: "codex",
      agents: [],
    } satisfies AssistantCatalog);
    renderScreen({ loadCatalog });
    expect(loadCatalog).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole("button", { name: "Choose project" }));
    fireEvent.press(screen.getByRole("button", { name: "Use Symphony project" }));

    await waitFor(() => expect(loadCatalog).toHaveBeenCalledWith("symphony"));
    expect(screen.getByRole("button", { name: "Choose project" })).toHaveTextContent(/Symphony/);
  });
});
