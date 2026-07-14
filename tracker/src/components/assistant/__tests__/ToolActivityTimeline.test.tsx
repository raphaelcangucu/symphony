import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToolActivityTimeline } from "@/components/assistant/ToolActivityTimeline";
import { i18n } from "@/i18n";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import type { AssistantToolCall } from "@/services/assistant";

function call(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "read_file", status: "complete", arguments: { path: "a.ex" }, output: "x", result: {}, ...overrides };
}

describe("ToolActivityTimeline", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders a single call without a group header", () => {
    renderWithI18n(<ToolActivityTimeline toolCalls={[call({ id: "1", arguments: { path: "only.ex" } })]} />);
    expect(screen.queryByTestId("tool-activity-group")).not.toBeInTheDocument();
    expect(screen.getByText("only.ex")).toBeInTheDocument();
  });

  it("groups 3 consecutive reads into one group header", () => {
    renderWithI18n(
      <ToolActivityTimeline
        toolCalls={[
          call({ id: "1", arguments: { path: "a.ex" } }),
          call({ id: "2", arguments: { path: "b.ex" } }),
          call({ id: "3", arguments: { path: "c.ex" } }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("tool-activity-group")).toHaveLength(1);
    expect(screen.getByText("Read 3 files")).toBeInTheDocument();
  });

  it("renders separate groups when kinds alternate", () => {
    renderWithI18n(
      <ToolActivityTimeline
        toolCalls={[
          call({ id: "1", name: "read_file", arguments: { path: "a.ex" } }),
          call({ id: "2", name: "read_file", arguments: { path: "b.ex" } }),
          call({ id: "3", name: "shell", arguments: { command: "ls" } }),
          call({ id: "4", name: "shell", arguments: { command: "pwd" } }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("tool-activity-group")).toHaveLength(2);
    expect(screen.getByText("Read 2 files")).toBeInTheDocument();
    expect(screen.getByText("Ran 2 commands")).toBeInTheDocument();
  });

  it("renders a task inline marker instead of a raw tool block", () => {
    renderWithI18n(
      <ToolActivityTimeline
        taskSnapshot={{
          source: "plan",
          tasks: [
            { id: "plan-0", text: "Write tests", status: "completed", source: "plan" },
            { id: "plan-1", text: "Ship", status: "pending", source: "plan" },
          ],
        }}
        toolCalls={[
          call({
            id: "plan-1",
            name: "update_plan",
            arguments: {
              plan: [
                { step: "Write tests", status: "completed" },
                { step: "Ship", status: "pending" },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Plan · 1/2 done")).toBeInTheDocument();
  });

  it("preserves an expanded group when a neighboring kind is inserted", () => {
    const initialCalls = [
      call({ id: "read-1", name: "read_file", arguments: { path: "a.ex" } }),
      call({ id: "read-2", name: "read_file", arguments: { path: "b.ex" } }),
      call({ id: "command-1", name: "shell", arguments: { command: "pwd" } }),
      call({ id: "command-2", name: "shell", arguments: { command: "ls" } }),
    ];
    const renderTimeline = (toolCalls: AssistantToolCall[]) => (
      <I18nextProvider i18n={i18n}>
        <ToolActivityTimeline toolCalls={toolCalls} />
      </I18nextProvider>
    );
    const { container, rerender } = render(
      renderTimeline(initialCalls),
    );
    const commandGroup = screen.getByRole("button", { name: /Ran 2 commands/i });
    fireEvent.click(commandGroup);

    expect(commandGroup).toHaveAttribute("aria-expanded", "true");
    expect(container.firstElementChild).toHaveClass("space-y-1");

    rerender(
      renderTimeline([
        initialCalls[0],
        initialCalls[1],
        call({ id: "action-1", name: "move_issue", arguments: { identifier: "SYM-1" } }),
        call({ id: "action-2", name: "move_issue", arguments: { identifier: "SYM-2" } }),
        initialCalls[2],
        initialCalls[3],
      ]),
    );

    const preservedCommandGroup = screen.getByRole("button", {
      name: /Ran 2 commands/i,
    });
    expect(preservedCommandGroup).toBe(commandGroup);
    expect(preservedCommandGroup).toHaveAttribute("aria-expanded", "true");
  });

  it("preserves expanded state when a singleton becomes a same-kind group", () => {
    const firstRead = call({
      id: "read-1",
      name: "read_file",
      arguments: { path: "first.ex" },
      output: "first body",
    });
    const renderTimeline = (toolCalls: AssistantToolCall[]) => (
      <I18nextProvider i18n={i18n}>
        <ToolActivityTimeline toolCalls={toolCalls} />
      </I18nextProvider>
    );
    const { container, rerender } = render(renderTimeline([firstRead]));
    const singletonSummary = screen.getByRole("button", { name: /first\.ex/i });
    fireEvent.click(singletonSummary);
    const timelineRoot = container.firstElementChild;
    const stableEntry = timelineRoot?.firstElementChild;

    expect(singletonSummary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("first body")).toBeInTheDocument();

    rerender(
      renderTimeline([
        firstRead,
        call({
          id: "read-2",
          name: "read_file",
          arguments: { path: "second.ex" },
          output: "second body",
        }),
      ]),
    );

    const groupSummary = screen.getByRole("button", {
      name: /Read 2 files/i,
    });
    expect(timelineRoot?.firstElementChild).toBe(stableEntry);
    expect(groupSummary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("first.ex")).toBeInTheDocument();
    expect(screen.getByText("second.ex")).toBeInTheDocument();
  });

  it("anchors a mixed group to its first idless canonical call", () => {
    const idlessRead = call({
      id: null,
      name: "read_file",
      arguments: { path: "legacy.ex" },
      output: "legacy body",
    });
    const renderTimeline = (toolCalls: AssistantToolCall[]) => (
      <I18nextProvider i18n={i18n}>
        <ToolActivityTimeline toolCalls={toolCalls} />
      </I18nextProvider>
    );
    const { container, rerender } = render(renderTimeline([idlessRead]));
    const singletonSummary = screen.getByRole("button", { name: /legacy\.ex/i });
    fireEvent.click(singletonSummary);
    const stableEntry = container.firstElementChild?.firstElementChild;

    rerender(
      renderTimeline([
        idlessRead,
        call({
          id: "provider-read-1",
          name: "read_file",
          arguments: { path: "provider.ex" },
          output: "provider body",
        }),
      ]),
    );

    const groupSummary = screen.getByRole("button", { name: /Read 2 files/i });
    expect(container.firstElementChild?.firstElementChild).toBe(stableEntry);
    expect(groupSummary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("legacy.ex")).toBeInTheDocument();
    expect(screen.getByText("provider.ex")).toBeInTheDocument();
  });

  it("preserves distinct idless calls with the same name, output, and order", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const firstCall = call({
      id: null,
      name: "shell",
      arguments: { command: "pwd" },
      output: "first output",
    });
    const secondCall = call({
      id: null,
      name: "shell",
      arguments: { command: "ls" },
      output: "second output",
    });

    try {
      renderWithI18n(
        <ToolActivityTimeline toolCalls={[firstCall, secondCall]} />,
      );

      expect(screen.getByText("Ran 2 commands")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("tool-activity-group"));

      const firstSummary = screen.getByRole("button", { name: /pwd/i });
      const secondSummary = screen.getByRole("button", { name: /ls/i });
      expect(
        firstSummary.compareDocumentPosition(secondSummary) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);

      fireEvent.click(firstSummary);
      fireEvent.click(secondSummary);
      expect(screen.getByText("first output")).toBeInTheDocument();
      expect(screen.getByText("second output")).toBeInTheDocument();
      expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps the first idless occurrence mounted when its data changes", () => {
    const firstCall = call({
      id: null,
      name: "shell",
      arguments: { command: "pwd" },
      output: "first output",
    });
    const secondCall = call({
      id: null,
      name: "shell",
      arguments: { command: "ls" },
      output: "second output",
    });
    const renderTimeline = (toolCalls: AssistantToolCall[]) => (
      <I18nextProvider i18n={i18n}>
        <ToolActivityTimeline toolCalls={toolCalls} />
      </I18nextProvider>
    );
    const { rerender } = render(renderTimeline([firstCall, secondCall]));
    const groupSummary = screen.getByTestId("tool-activity-group");
    fireEvent.click(groupSummary);
    const firstSummary = screen.getByRole("button", { name: /pwd/i });
    fireEvent.click(firstSummary);

    rerender(
      renderTimeline([
        call({
          id: null,
          name: "shell",
          arguments: { command: "echo changed" },
          output: "changed output",
        }),
        secondCall,
      ]),
    );

    const updatedSummary = screen.getByRole("button", { name: /echo changed/i });
    expect(screen.getByTestId("tool-activity-group")).toBe(groupSummary);
    expect(updatedSummary).toBe(firstSummary);
    expect(updatedSummary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("changed output")).toBeInTheDocument();
    expect(screen.queryByText("first output")).not.toBeInTheDocument();
  });

  it("appends a third same-name idless occurrence without replacing prior rows", () => {
    const firstCall = call({
      id: null,
      name: "shell",
      arguments: { command: "pwd" },
      output: "first output",
    });
    const secondCall = call({
      id: null,
      name: "shell",
      arguments: { command: "ls" },
      output: "second output",
    });
    const renderTimeline = (toolCalls: AssistantToolCall[]) => (
      <I18nextProvider i18n={i18n}>
        <ToolActivityTimeline toolCalls={toolCalls} />
      </I18nextProvider>
    );
    const { rerender } = render(renderTimeline([firstCall, secondCall]));
    const groupSummary = screen.getByTestId("tool-activity-group");
    fireEvent.click(groupSummary);
    const firstSummary = screen.getByRole("button", { name: /pwd/i });

    rerender(
      renderTimeline([
        firstCall,
        secondCall,
        call({
          id: null,
          name: "shell",
          arguments: { command: "git status" },
          output: "third output",
        }),
      ]),
    );

    expect(screen.getByTestId("tool-activity-group")).toBe(groupSummary);
    expect(screen.getByText("Ran 3 commands")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pwd/i })).toBe(firstSummary);
    expect(screen.getByRole("button", { name: /git status/i })).toBeInTheDocument();
  });

  it("renders duplicate provider snapshots once using the latest status", () => {
    renderWithI18n(
      <ToolActivityTimeline
        toolCalls={[
          call({
            id: "duplicate-1",
            status: "running",
            arguments: { path: "stale.ex" },
          }),
          call({
            id: "duplicate-1",
            status: "error",
            arguments: { path: "latest.ex" },
            output: "latest failure",
          }),
        ]}
      />,
    );

    expect(screen.queryByText("stale.ex")).not.toBeInTheDocument();
    expect(screen.getByText("latest.ex")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-activity-group")).not.toBeInTheDocument();
  });

  it("canonicalizes duplicate snapshots before rendering grouped row keys", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      renderWithI18n(
        <ToolActivityTimeline
          toolCalls={[
            call({
              id: "duplicate-1",
              arguments: { path: "stale.ex" },
            }),
            call({
              id: "other-1",
              arguments: { path: "other.ex" },
            }),
            call({
              id: "duplicate-1",
              arguments: { path: "latest.ex" },
            }),
          ]}
        />,
      );

      fireEvent.click(screen.getByTestId("tool-activity-group"));

      expect(screen.getByText("Read 2 files")).toBeInTheDocument();
      expect(screen.queryByText("stale.ex")).not.toBeInTheDocument();
      expect(screen.getByText("latest.ex")).toBeInTheDocument();
      expect(screen.getByText("other.ex")).toBeInTheDocument();
      expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    } finally {
      consoleError.mockRestore();
    }
  });
});
