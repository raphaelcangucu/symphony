import { Braces, Code2, Database, FileCode2, FileJson, FileText, Folder, FolderTree, List, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { diffStatsFromPatch } from "@/lib/diffStats";
import { buildGitDiffTree, type GitDiffTreeNode } from "@/lib/gitDiffTree";
import { cn } from "@/lib/utils";
import type { GitDiffFileChange } from "@/types/gitDiff";

interface GitDiffFileTreeProps {
  files: GitDiffFileChange[];
  flat: boolean;
  selectedPath: string | null;
  onSelect: (file: GitDiffFileChange) => void;
  onToggleFlat: () => void;
  commentCountsByPath?: Record<string, number>;
}

export function GitDiffFileTree({
  files,
  flat,
  selectedPath,
  onSelect,
  onToggleFlat,
  commentCountsByPath,
}: GitDiffFileTreeProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return files;
    return files.filter((file) => file.path.toLowerCase().includes(normalizedQuery));
  }, [files, query]);
  const tree = buildGitDiffTree(filteredFiles);

  return (
    <div className="flex min-h-0 flex-col bg-muted/15">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("issue.diff.files", { count: filteredFiles.length })}
        </span>
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-background"
          onClick={onToggleFlat}
          title={flat ? t("issue.diff.list.tree") : t("issue.diff.list.flat")}
        >
          {flat ? <FolderTree className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
          <span>{flat ? t("issue.diff.list.tree") : t("issue.diff.list.flat")}</span>
        </button>
      </div>
      <div className="border-b px-2 py-1.5">
        <div className="flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-muted-foreground">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("issue.diff.filterPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {filteredFiles.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t("issue.diff.noFiles")}</p>
        ) : flat ? (
          filteredFiles.map((file) => (
            <FileRow
              key={`${file.path}:${file.oldPath ?? ""}`}
              file={file}
              name={file.path}
              depth={0}
              selected={selectedPath === file.path}
              onSelect={onSelect}
              commentCount={commentCountsByPath?.[file.path] ?? 0}
            />
          ))
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              selectedPath={selectedPath}
              onSelect={onSelect}
              commentCountsByPath={commentCountsByPath}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  selectedPath,
  onSelect,
  commentCountsByPath,
  depth = 0,
}: {
  node: GitDiffTreeNode;
  selectedPath: string | null;
  onSelect: (file: GitDiffFileChange) => void;
  commentCountsByPath?: Record<string, number>;
  depth?: number;
}) {
  if (node.type === "folder") {
    return (
      <div>
        <div
          className="flex h-6 items-center gap-1.5 rounded px-1.5 text-[11px] font-medium text-muted-foreground"
          style={{ paddingLeft: 6 + depth * 10 }}
        >
          <Folder className="h-3.5 w-3.5 text-amber-500" />
          <span className="truncate">{node.name}</span>
        </div>
        {node.children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            selectedPath={selectedPath}
            onSelect={onSelect}
            commentCountsByPath={commentCountsByPath}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  const file = node.file!;
  return (
    <FileRow
      file={file}
      name={node.name}
      depth={depth}
      selected={selectedPath === file.path}
      onSelect={onSelect}
      commentCount={commentCountsByPath?.[file.path] ?? 0}
    />
  );
}

function FileRow({
  file,
  name,
  depth,
  selected,
  onSelect,
  commentCount = 0,
}: {
  file: GitDiffFileChange;
  name: string;
  depth: number;
  selected: boolean;
  onSelect: (file: GitDiffFileChange) => void;
  commentCount?: number;
}) {
  const stats = diffStatsFromPatch(file.patch);

  return (
    <button
      type="button"
      onClick={() => onSelect(file)}
      className={cn(
        "group flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs hover:bg-background",
        selected && "bg-background text-foreground shadow-sm ring-1 ring-border",
      )}
      style={{ paddingLeft: 6 + depth * 10 }}
    >
      <FileIcon path={file.path} />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{name}</span>
      <span className="shrink-0 tabular-nums text-[10px] text-emerald-600">+{stats.additions}</span>
      <span className="shrink-0 tabular-nums text-[10px] text-rose-600">-{stats.deletions}</span>
      {commentCount > 0 ? (
        <span
          className="shrink-0 text-[10px] text-sky-600"
          title={`${commentCount} comments`}
        >
          💬{commentCount}
        </span>
      ) : null}
    </button>
  );
}

function FileIcon({ path }: { path: string }) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const className = "h-3.5 w-3.5 shrink-0";

  if (extension === "json") return <FileJson aria-label="json file" className={cn(className, "text-yellow-600")} />;
  if (extension === "php") return <FileCode2 aria-label="php file" className={cn(className, "text-indigo-500")} />;
  if (extension === "ts" || extension === "tsx" || extension === "js" || extension === "jsx") {
    return <Code2 aria-label={`${extension} file`} className={cn(className, "text-sky-500")} />;
  }
  if (extension === "sql") return <Database aria-label="sql file" className={cn(className, "text-purple-500")} />;
  if (extension === "css" || extension === "scss") {
    return <Braces aria-label={`${extension} file`} className={cn(className, "text-pink-500")} />;
  }

  return <FileText aria-label="file" className={cn(className, "text-muted-foreground")} />;
}
