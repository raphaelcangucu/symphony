export interface KbExtraContextInput {
  repoSlug: string;
  pagePath: string;
  title: string;
  body: string;
  selection: string;
}

export interface KbExtraContext {
  surface: "kb";
  kb: {
    repoSlug: string;
    pagePath: string;
    title: string;
    body: string;
    selection: string;
  };
}

/**
 * Builds the live KB snapshot merged into every Maestro message on a KB page.
 * Shared by the KB workspace registration and any consumer that needs the exact
 * `assistant:kb:*` context shape the backend prompt reads.
 */
export function buildKbExtraContext({
  repoSlug,
  pagePath,
  title,
  body,
  selection,
}: KbExtraContextInput): KbExtraContext {
  return {
    surface: "kb",
    kb: { repoSlug, pagePath, title, body, selection },
  };
}
