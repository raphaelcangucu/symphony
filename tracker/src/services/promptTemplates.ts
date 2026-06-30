import { requireProjectSlug } from "@/lib/serviceValidation";
import type { PromptTemplate } from "@/types/prompt-template";

import { http, trackerPath, unwrapData } from "./http";

interface PromptTemplateDto {
  id?: number | string;
  slug?: string;
  name?: string;
  description?: string | null;
  category?: string | null;
  body?: string;
  agentKind?: string | null;
  model?: string | null;
  effort?: string | null;
  mode?: string | null;
  scope?: string;
  builtIn?: boolean;
  enabled?: boolean;
  position?: number;
  insertedAt?: string | null;
  updatedAt?: string | null;
}

export async function listPromptTemplates(projectSlug?: string): Promise<PromptTemplate[]> {
  const endpoint =
    projectSlug === undefined
      ? trackerPath("/prompt-templates")
      : trackerPath(`/projects/${encodeURIComponent(requireProjectSlug(projectSlug))}/prompt-templates`);

  const response = await http.get(endpoint);
  const payload = unwrapData<unknown>(response);

  if (!Array.isArray(payload)) {
    throw new Error("prompt template list response must be an array");
  }

  return payload.map((item, index) => normalizePromptTemplate(item as PromptTemplateDto, index));
}

function normalizePromptTemplate(dto: PromptTemplateDto, index: number): PromptTemplate {
  return {
    id: normalizeId(dto.id, index),
    slug: requiredTrimmedString(dto.slug, `promptTemplates[${index}].slug`),
    name: requiredPresentString(dto.name, `promptTemplates[${index}].name`),
    description: optionalString(dto.description),
    category: optionalString(dto.category),
    body: requiredPresentString(dto.body, `promptTemplates[${index}].body`),
    agentKind: optionalString(dto.agentKind),
    model: optionalString(dto.model),
    effort: optionalString(dto.effort),
    mode: optionalString(dto.mode),
    scope: requiredTrimmedString(dto.scope, `promptTemplates[${index}].scope`),
    builtIn: dto.builtIn === true,
    enabled: dto.enabled !== false,
    position: Number.isInteger(dto.position) ? (dto.position as number) : 0,
    insertedAt: optionalString(dto.insertedAt),
    updatedAt: optionalString(dto.updatedAt),
  };
}

function normalizeId(value: number | string | undefined, index: number): string {
  if (typeof value === "number" || typeof value === "string") {
    const id = String(value).trim();
    if (id) return id;
  }

  throw new Error(`promptTemplates[${index}].id is required`);
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
