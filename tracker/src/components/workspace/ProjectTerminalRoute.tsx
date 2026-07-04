import { useTranslation } from "react-i18next";

import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { ProjectTerminal } from "@/components/terminal/IssueTerminal";

export function ProjectTerminalRoute() {
  const { t } = useTranslation();
  const { projectSlug } = useWorkspace();

  return (
    <main className="h-[calc(100vh-4rem)] overflow-auto bg-gradient-to-br from-muted/40 via-background to-muted/20 p-5">
      <section className="mx-auto flex h-full max-w-6xl flex-col gap-3 rounded-2xl border border-border/60 bg-background p-5 shadow-sm">
        <div>
          <h2 className="text-base font-semibold">{t("issue.terminal.projectTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("issue.terminal.projectDescription")}</p>
        </div>
        <div className="min-h-0 flex-1">
          <ProjectTerminal projectSlug={projectSlug} className="h-full" />
        </div>
      </section>
    </main>
  );
}
