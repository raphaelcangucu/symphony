import { useTranslation } from "react-i18next";

import { TerminalView } from "@/components/terminal/TerminalView";

interface IssueTerminalProps {
  projectSlug: string;
  issueIdentifier: string;
}

interface ProjectTerminalProps {
  projectSlug: string;
  className?: string;
}

export function IssueTerminal({ projectSlug, issueIdentifier }: IssueTerminalProps) {
  const { t } = useTranslation();

  return (
    <TerminalView
      kind="issue"
      projectSlug={projectSlug}
      issueIdentifier={issueIdentifier}
      ariaLabel={t("issue.terminal.ariaLabel", { identifier: issueIdentifier })}
      className="h-[480px]"
    />
  );
}

export function ProjectTerminal({ projectSlug, className }: ProjectTerminalProps) {
  const { t } = useTranslation();

  return (
    <TerminalView
      kind="project-devenv"
      projectSlug={projectSlug}
      ariaLabel={t("issue.terminal.projectAriaLabel", { projectSlug })}
      className={className}
    />
  );
}
