import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const PROVIDERS = Object.freeze(["codex", "cursor", "claude"]);
export const PATHS = Object.freeze(["session", "orchestrator"]);

export const RUN_MATRIX = Object.freeze(
  PATHS.flatMap((path) =>
    PROVIDERS.map((provider) =>
      Object.freeze({
        id: `${path}-${provider}`,
        path,
        provider,
      }),
    ),
  ),
);

export async function readCanonicalPrompt() {
  return readFile(new URL("../prompt.md", import.meta.url), "utf8");
}

export function promptSha256(prompt) {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

export function workflowPromptTemplate(workflowMarkdown) {
  const match = String(workflowMarkdown ?? "").match(
    /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/,
  );
  if (!match) throw new Error("workflow markdown has no prompt body");
  return match[1];
}
