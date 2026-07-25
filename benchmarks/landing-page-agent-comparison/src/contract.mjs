import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const PROVIDERS = Object.freeze(["codex", "cursor", "claude"]);
export const PATHS = Object.freeze(["session", "orchestrator"]);

const PROVIDER_MATRICES = Object.freeze({
  "providers-default": Object.freeze({
    codex: Object.freeze({ model: "gpt-5.5", effort: "medium" }),
    claude: Object.freeze({ model: "claude-sonnet-5", effort: "medium" }),
    cursor: Object.freeze({ model: "composer-2.5", effort: null }),
  }),
  "providers-advanced": Object.freeze({
    codex: Object.freeze({ model: "gpt-5.5", effort: "high" }),
    claude: Object.freeze({ model: "claude-opus-5", effort: "high" }),
    cursor: Object.freeze({ model: "cursor-grok-4.5-high", effort: null }),
  }),
});

const CODEX_56_DEFAULTS = Object.freeze([
  Object.freeze({ variant: "sol", model: "gpt-5.6-sol", effort: "low" }),
  Object.freeze({ variant: "terra", model: "gpt-5.6-terra", effort: "medium" }),
  Object.freeze({ variant: "luna", model: "gpt-5.6-luna", effort: "medium" }),
]);

const providerRuns = Object.entries(PROVIDER_MATRICES).flatMap(
  ([matrix, settings]) =>
    PATHS.flatMap((path) =>
      PROVIDERS.map((provider) =>
        Object.freeze({
          id: `${matrix}-${path}-${provider}`,
          matrix,
          path,
          provider,
          requested_model: settings[provider].model,
          requested_effort: settings[provider].effort,
        }),
      ),
    ),
);

const codexRuns = CODEX_56_DEFAULTS.map(({ variant, model, effort }) =>
  Object.freeze({
    id: `codex-5.6-defaults-session-${variant}`,
    matrix: "codex-5.6-defaults",
    path: "session",
    provider: "codex",
    variant,
    requested_model: model,
    requested_effort: effort,
  }),
);

export const RUN_MATRIX = Object.freeze([...providerRuns, ...codexRuns]);

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
