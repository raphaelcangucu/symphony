import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { splitWorkflowMarkdown } from "@/lib/workflowMarkdown";

interface WorkflowMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}

export function WorkflowMarkdownEditor({ value, onChange, rows = 22 }: WorkflowMarkdownEditorProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"write" | "preview">("write");
  const parts = useMemo(() => splitWorkflowMarkdown(value), [value]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("project.config.workflowEditor.hint")}</p>
      <div className="rounded-md border">
        <div className="flex gap-1 border-b bg-muted/30 p-1">
          <EditorTab active={tab === "write"} onClick={() => setTab("write")}>
            {t("project.config.workflowEditor.edit")}
          </EditorTab>
          <EditorTab active={tab === "preview"} onClick={() => setTab("preview")}>
            {t("project.config.workflowEditor.preview")}
          </EditorTab>
        </div>
        {tab === "write" ? (
          <Textarea
            className="rounded-none border-0 font-mono text-xs leading-relaxed focus-visible:ring-0"
            value={value}
            rows={rows}
            onChange={(event) => onChange(event.target.value)}
            aria-label={t("project.config.workflowEditor.aria")}
            spellCheck={false}
          />
        ) : (
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("project.config.workflowEditor.frontMatter")}
              </p>
              {parts.frontMatter.trim() ? (
                <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">{parts.frontMatter}</pre>
              ) : (
                <p className="text-sm text-muted-foreground">{t("project.config.workflowEditor.noFrontMatter")}</p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("project.config.workflowEditor.promptBody")}
              </p>
              {parts.body.trim() ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Markdown>{parts.body}</Markdown>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("project.config.workflowEditor.noPromptBody")}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EditorTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded px-3 py-1 text-sm", active ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
    >
      {children}
    </button>
  );
}
