export type KbDraftKind = "page" | "folder";

export interface KbPageDraft {
  repoSlug: string;
  parentPath: string;
  /** `null` = first position under `parentPath`; otherwise insert after this page path. */
  insertAfterPath: string | null;
  kind: KbDraftKind;
}

export interface KbRenameTarget {
  repoSlug: string;
  path: string;
  title: string;
}

export interface KbInlineEdit {
  draft: KbPageDraft | null;
  rename: KbRenameTarget | null;
  onDraftSubmit: (title: string) => Promise<void> | void;
  onRenameSubmit: (title: string) => Promise<void> | void;
  onCancel: () => void;
}

export function draftMatchesList(
  draft: KbPageDraft | null,
  repoSlug: string,
  parentPath: string,
): draft is KbPageDraft {
  return draft !== null && draft.repoSlug === repoSlug && draft.parentPath === parentPath;
}

export function renameMatches(
  rename: KbRenameTarget | null,
  repoSlug: string,
  path: string,
): rename is KbRenameTarget {
  return rename !== null && rename.repoSlug === repoSlug && rename.path === path;
}
