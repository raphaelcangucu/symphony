import { requireProjectSlug } from "@/lib/serviceValidation";
import type { SlashCommandContext } from "@/components/assistant/slashCommands";
import type { AssistantCommand } from "@/types/assistant-command";

import { http, trackerPath, unwrapData } from "./http";

interface AssistantCommandDto {
  slug?: string;
  name?: string;
  description?: string;
  kind?: string;
  category?: string | null;
  submitKind?: string | null;
  source?: string;
}

export async function listAssistantCommands(
  context: SlashCommandContext,
  projectSlug?: string,
): Promise<AssistantCommand[]> {
  const endpoint =
    projectSlug === undefined
      ? trackerPath(`/assistant/commands?context=${encodeURIComponent(context)}`)
      : trackerPath(
          `/projects/${encodeURIComponent(requireProjectSlug(projectSlug))}/assistant/commands?context=${encodeURIComponent(context)}`,
        );

  const response = await http.get(endpoint);
  const payload = unwrapData<unknown>(response);

  if (!Array.isArray(payload)) {
    throw new Error("assistant command list response must be an array");
  }

  return payload.map((item, index) => normalizeAssistantCommand(item as AssistantCommandDto, index));
}

function normalizeAssistantCommand(dto: AssistantCommandDto, index: number): AssistantCommand {
  return {
    slug: requiredTrimmedString(dto.slug, `assistantCommands[${index}].slug`),
    name: requiredPresentString(dto.name, `assistantCommands[${index}].name`),
    description: requiredPresentString(dto.description, `assistantCommands[${index}].description`),
    kind: normalizeKind(dto.kind, `assistantCommands[${index}].kind`),
    category: optionalString(dto.category),
    submitKind: normalizeSubmitKind(dto.submitKind, `assistantCommands[${index}].submitKind`),
    source: requiredTrimmedString(dto.source, `assistantCommands[${index}].source`),
  };
}

function normalizeKind(value: unknown, field: string): AssistantCommand["kind"] {
  if (value === "builtin" || value === "skill") {
    return value;
  }
  throw new Error(`${field} must be 'builtin' or 'skill'`);
}

function normalizeSubmitKind(value: unknown, field: string): AssistantCommand["submitKind"] {
  if (value === null || value === undefined) return null;
  if (value === "goal" || value === "infer" || value === "btw" || value === "message") {
    return value;
  }
  throw new Error(`${field} must be one of: goal, infer, btw, message, null`);
}

function requiredTrimmedString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} is required`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }

  return trimmed;
}

function requiredPresentString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }

  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
