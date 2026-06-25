import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { KbProjectOverview, KbTreeNode as KbTreeNodeType } from "@/types/knowledgeBase";
import { KbTreeNode } from "./KbTreeNode";

interface Props {
  projectSlug: string;
  overview: KbProjectOverview;
  treesByRepo: Record<string, KbTreeNodeType[]>;
  activeRepo: string | null;
  activePath: string | null;
  onSelectRepo: (repoSlug: string) => void;
}

export function KbSidebar({ projectSlug, overview, treesByRepo, activeRepo, onSelectRepo }: Props) {
  const { t } = useTranslation();

  return (
    <nav className="flex flex-col gap-3 overflow-y-auto p-2">
      {overview.repositories.map((repo) => (
        <section key={repo.repoSlug}>
          <button
            type="button"
            className={cn(
              "w-full rounded-md px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide",
              activeRepo === repo.repoSlug ? "text-foreground" : "text-muted-foreground",
            )}
            title={repo.githubFullName ?? repo.workspacePath}
            onClick={() => onSelectRepo(repo.repoSlug)}
          >
            {repo.workspacePath}
          </button>
          {!repo.docsPresent && (
            <p className="px-2 text-xs text-muted-foreground">{t("kb.sidebar.noDocs")}</p>
          )}
          {(treesByRepo[repo.repoSlug] ?? []).map((node) => (
            <KbTreeNode
              key={node.path}
              projectSlug={projectSlug}
              repoSlug={repo.repoSlug}
              node={node}
              depth={0}
            />
          ))}
        </section>
      ))}
    </nav>
  );
}
