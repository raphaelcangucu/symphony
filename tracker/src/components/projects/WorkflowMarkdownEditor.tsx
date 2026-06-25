import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { splitWorkflowMarkdown } from "@/lib/workflowMarkdown";

interface WorkflowMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}

type EditorTab = "write" | "preview";
type PreviewSection = "frontMatter" | "promptBody";

export function WorkflowMarkdownEditor({ value, onChange, rows = 22 }: WorkflowMarkdownEditorProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<EditorTab>("write");
  const [previewSection, setPreviewSection] = useState<PreviewSection>("frontMatter");
  const parts = useMemo(() => splitWorkflowMarkdown(value), [value]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("project.config.workflowEditor.hint")}</p>
      <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
        <div className="flex gap-1 border-b bg-muted/40 p-1.5">
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
          <div className="space-y-4 p-4">
            <div
              className="inline-flex rounded-full border bg-muted/50 p-1"
              role="tablist"
              aria-label={t("project.config.workflowEditor.preview")}
            >
              <PreviewPill
                active={previewSection === "frontMatter"}
                onClick={() => setPreviewSection("frontMatter")}
              >
                {t("project.config.workflowEditor.frontMatter")}
              </PreviewPill>
              <PreviewPill
                active={previewSection === "promptBody"}
                onClick={() => setPreviewSection("promptBody")}
              >
                {t("project.config.workflowEditor.promptBody")}
              </PreviewPill>
            </div>

            <div className="rounded-lg border bg-muted/20">
              <ScrollArea className="max-h-[min(28rem,60vh)] p-4">
                {previewSection === "frontMatter" ? (
                  parts.frontMatter.trim() ? (
                    <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90">
                      {parts.frontMatter}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("project.config.workflowEditor.noFrontMatter")}</p>
                  )
                ) : parts.body.trim() ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <Markdown>{parts.body}</Markdown>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("project.config.workflowEditor.noPromptBody")}</p>
                )}
              </ScrollArea>
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
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm transition-colors",
        active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PreviewPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-3.5 py-1 text-xs font-medium transition-all",
        active
          ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
