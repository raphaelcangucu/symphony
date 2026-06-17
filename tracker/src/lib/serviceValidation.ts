import { i18n } from "@/i18n";

export function requireProjectSlug(projectSlug: string): string {
  const slug = typeof projectSlug === "string" ? projectSlug.trim() : "";
  if (!slug) throw new Error(i18n.t("project.services.validation.projectSlugRequired"));
  return slug;
}

export function requireNonBlank(value: string, field: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) throw new Error(i18n.t("project.services.validation.fieldRequired", { field }));
  return trimmed;
}

export function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(i18n.t("project.services.validation.positiveIntegerRequired", { field }));
  }
  return value;
}

export function assertSafeDocumentPath(path: string): void {
  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(i18n.t("project.services.validation.documentPathInvalid"));
  }
}
