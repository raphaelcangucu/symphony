import { BookOpen, FolderGit2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { kbRepoPath } from "@/lib/kbRoutes";
import type { KbRepositorySummary } from "@/types/knowledgeBase";

interface Props {
  projectSlug: string;
  projectName: string;
  repositories: KbRepositorySummary[];
}

export function KbProjectHome({ projectSlug, projectName, repositories }: Props) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center gap-3">
        <BookOpen className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold">{t("kb.home.title", { project: projectName })}</h1>
          <p className="text-sm text-muted-foreground">{t("kb.home.intro")}</p>
        </div>
      </div>

      {repositories.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("kb.home.noRepositories")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {repositories.map((repo) => (
            <li key={repo.repoSlug}>
              <Link
                to={kbRepoPath(projectSlug, repo.repoSlug)}
                className="flex items-center justify-between gap-3 rounded-md border px-4 py-3 hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{repo.workspacePath}</span>
                  {repo.githubFullName && (
                    <span className="text-xs text-muted-foreground">{repo.githubFullName}</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {repo.docsPresent ? t("kb.home.openDocs") : t("kb.sidebar.noDocs")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
