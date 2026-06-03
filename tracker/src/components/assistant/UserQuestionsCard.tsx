import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserQuestion, UserQuestionsRequest } from "@/services/assistant";

const OTHER_VALUE = "__other__";

interface UserQuestionsCardProps {
  request: UserQuestionsRequest;
  onSubmit: (requestId: string | number, answers: Record<string, string>) => void;
  disabled?: boolean;
}

interface DraftAnswer {
  selected: string | null;
  otherText: string;
  freeformText: string;
}

function emptyDraft(): DraftAnswer {
  return { selected: null, otherText: "", freeformText: "" };
}

function isFreeform(question: UserQuestion): boolean {
  return question.options == null || question.options.length === 0;
}

function answerValue(question: UserQuestion, draft: DraftAnswer): string | null {
  if (isFreeform(question)) {
    const text = draft.freeformText.trim();
    return text.length > 0 ? text : null;
  }

  if (draft.selected === OTHER_VALUE) {
    const text = draft.otherText.trim();
    return text.length > 0 ? text : null;
  }

  return draft.selected;
}

export function UserQuestionsCard({ request, onSubmit, disabled }: UserQuestionsCardProps) {
  const { questions } = request;
  const [activeIndex, setActiveIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, emptyDraft()])),
  );

  const updateDraft = (id: string, patch: Partial<DraftAnswer>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyDraft()), ...patch } }));

  const allAnswered = useMemo(
    () => questions.every((question) => answerValue(question, drafts[question.id] ?? emptyDraft()) != null),
    [questions, drafts],
  );

  const active = questions[activeIndex] ?? questions[0];
  if (!active) return null;
  const draft = drafts[active.id] ?? emptyDraft();

  const handleSubmit = () => {
    if (!allAnswered || disabled) return;

    const answers: Record<string, string> = {};
    for (const question of questions) {
      const value = answerValue(question, drafts[question.id] ?? emptyDraft());
      if (value != null) answers[question.id] = value;
    }

    onSubmit(request.requestId, answers);
  };

  return (
    <div className="rounded-2xl border bg-card p-3 shadow-sm" data-testid="user-questions-card">
      {questions.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {questions.map((question, index) => (
            <button
              key={question.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs",
                index === activeIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                answerValue(question, drafts[question.id] ?? emptyDraft()) != null ? "ring-1 ring-primary/40" : "",
              )}
            >
              {question.header || `Q${index + 1}`}
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-semibold">{active.header}</p>
        <p className="text-sm text-muted-foreground">{active.question}</p>

        {isFreeform(active) ? (
          <textarea
            className="w-full rounded-md border bg-background p-2 text-sm"
            rows={3}
            value={draft.freeformText}
            onChange={(event) => updateDraft(active.id, { freeformText: event.target.value })}
            placeholder="Type your answer"
            disabled={disabled}
          />
        ) : (
          <div className="space-y-1.5">
            {active.options?.map((option) => (
              <label
                key={option.label}
                className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50"
              >
                <input
                  type="radio"
                  name={`uq-${active.id}`}
                  className="mt-0.5"
                  checked={draft.selected === option.label}
                  onChange={() => updateDraft(active.id, { selected: option.label })}
                  disabled={disabled}
                />
                <span className="min-w-0">
                  <span className="font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="block text-xs text-muted-foreground">{option.description}</span>
                  ) : null}
                </span>
              </label>
            ))}

            {active.isOther ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50">
                <input
                  type="radio"
                  name={`uq-${active.id}`}
                  className="mt-0.5"
                  checked={draft.selected === OTHER_VALUE}
                  onChange={() => updateDraft(active.id, { selected: OTHER_VALUE })}
                  disabled={disabled}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">Other</span>
                  {draft.selected === OTHER_VALUE ? (
                    <input
                      type="text"
                      className="mt-1 w-full rounded-md border bg-background p-1.5 text-sm"
                      value={draft.otherText}
                      onChange={(event) => updateDraft(active.id, { otherText: event.target.value })}
                      placeholder="Type your answer"
                      disabled={disabled}
                    />
                  ) : null}
                </span>
              </label>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" onClick={handleSubmit} disabled={!allAnswered || disabled}>
          Submit answers
        </Button>
      </div>
    </div>
  );
}
