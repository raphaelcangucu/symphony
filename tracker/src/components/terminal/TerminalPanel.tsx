import { useTranslation } from "react-i18next";

import { IssueTerminal } from "./IssueTerminal";

interface TerminalPanelProps {
  projectSlug: string;
  issueIdentifier: string;
}

export function TerminalPanel({ projectSlug, issueIdentifier }: TerminalPanelProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{t("issue.terminal.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("issue.terminal.description")}</p>
      </div>
      <IssueTerminal projectSlug={projectSlug} issueIdentifier={issueIdentifier} />
    </section>
  );
}
