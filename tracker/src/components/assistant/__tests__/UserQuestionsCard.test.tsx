import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UserQuestionsCard } from "../UserQuestionsCard";
import type { UserQuestionsRequest } from "@/services/assistant";

const optionsRequest: UserQuestionsRequest = {
  requestId: 112,
  questions: [
    {
      id: "q1",
      header: "Pick one",
      question: "How should I proceed?",
      isOther: false,
      isSecret: false,
      options: [
        { label: "Use default", description: "default behavior" },
        { label: "Skip", description: "skip it" },
      ],
    },
  ],
};

describe("UserQuestionsCard", () => {
  it("disables submit until answered, then submits the selected label", async () => {
    const onSubmit = vi.fn();
    render(<UserQuestionsCard request={optionsRequest} onSubmit={onSubmit} />);

    const submit = screen.getByRole("button", { name: /submit answers/i });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/Use default/i));
    expect(submit).toBeEnabled();

    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(112, { q1: "Use default" });
  });

  it("supports an Other free-text answer", async () => {
    const onSubmit = vi.fn();
    const request: UserQuestionsRequest = {
      requestId: 1,
      questions: [{ ...optionsRequest.questions[0], isOther: true }],
    };
    render(<UserQuestionsCard request={request} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByLabelText(/^Other$/i));
    await userEvent.type(screen.getByPlaceholderText(/type your answer/i), "custom path");
    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    expect(onSubmit).toHaveBeenCalledWith(1, { q1: "custom path" });
  });

  it("renders a free-text input for freeform questions (null options)", async () => {
    const onSubmit = vi.fn();
    const request: UserQuestionsRequest = {
      requestId: 2,
      questions: [
        { id: "f1", header: "Context", question: "What comment?", isOther: false, isSecret: false, options: null },
      ],
    };
    render(<UserQuestionsCard request={request} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByPlaceholderText(/type your answer/i), "post this");
    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    expect(onSubmit).toHaveBeenCalledWith(2, { f1: "post this" });
  });
});
