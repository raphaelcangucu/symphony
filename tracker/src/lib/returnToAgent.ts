import type { TFunction } from "i18next";

import { i18n } from "@/i18n";

export type ReturnToAgentTemplate = "evidence" | "fix" | "review_feedback" | "custom";

export interface ReturnToAgentHandoff {
  projectSlug: string;
  issueIdentifier: string;
  template: ReturnToAgentTemplate;
  createdAt: number;
}

const STORAGE_KEY = "symphony:return-to-agent-handoff";

export function returnToAgentTemplateLabel(
  template: ReturnToAgentTemplate,
  t: TFunction = i18n.t.bind(i18n) as TFunction,
): string {
  return t(`issue.returnToAgent.templates.${template}.label`);
}

export function returnToAgentTemplateText(
  template: ReturnToAgentTemplate,
  t: TFunction = i18n.t.bind(i18n) as TFunction,
): string {
  return t(`issue.returnToAgent.templates.${template}.body`);
}

export function stashReturnToAgentHandoff(handoff: Omit<ReturnToAgentHandoff, "createdAt">): void {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...handoff,
      createdAt: Date.now(),
    } satisfies ReturnToAgentHandoff),
  );
}

export function consumeReturnToAgentHandoff(
  projectSlug: string,
  issueIdentifier: string,
): ReturnToAgentHandoff | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ReturnToAgentHandoff;
    if (parsed.projectSlug !== projectSlug || parsed.issueIdentifier !== issueIdentifier) {
      return null;
    }

    sessionStorage.removeItem(STORAGE_KEY);
    return parsed;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
