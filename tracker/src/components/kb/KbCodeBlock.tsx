import CodeBlock from "@tiptap/extension-code-block";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Code2, Eye, Loader2, TriangleAlert } from "lucide-react";

import {
  detectMermaidTheme,
  renderMermaid,
  type MermaidTheme,
} from "@/lib/mermaid";
import { cn } from "@/lib/utils";

const MERMAID_LANGUAGE = "mermaid";
// Re-rendering Mermaid on every keystroke is wasteful and flickers; wait for a
// short pause in edits before re-parsing the (potentially incomplete) source.
const RENDER_DEBOUNCE_MS = 300;

type ViewMode = "preview" | "code";

type MermaidViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ok"; svg: string }
  | { status: "error"; message: string };

function readLanguage(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Renders the Mermaid source to SVG whenever the source (or app theme) changes,
 * but only while the preview is the active view. Re-renders on theme toggle by
 * observing the documentElement class that ThemeToggle mutates.
 */
function useMermaidRender(source: string, active: boolean): MermaidViewState {
  const [state, setState] = useState<MermaidViewState>({ status: "idle" });
  const [theme, setTheme] = useState<MermaidTheme>(() => detectMermaidTheme());

  useEffect(() => {
    if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      const next = detectMermaidTheme();
      setTheme((prev) => (prev === next ? prev : next));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return;

    const trimmed = source.trim();
    if (trimmed.length === 0) {
      setState({ status: "empty" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });
    const handle = setTimeout(() => {
      void renderMermaid(trimmed, theme).then((result) => {
        if (cancelled) return;
        setState(result);
      });
    }, RENDER_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [source, theme, active]);

  return state;
}

function MermaidToolbar({
  mode,
  onModeChange,
}: {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}) {
  const { t } = useTranslation();

  const tab = (value: ViewMode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      contentEditable={false}
      aria-pressed={mode === value}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onModeChange(value)}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition",
        mode === value
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="kb-mermaid-toolbar" contentEditable={false}>
      <span className="kb-mermaid-label">{t("kb.editor.mermaid.label")}</span>
      <div className="kb-mermaid-tabs">
        {tab("preview", t("kb.editor.mermaid.preview"), <Eye className="h-3.5 w-3.5" />)}
        {tab("code", t("kb.editor.mermaid.code"), <Code2 className="h-3.5 w-3.5" />)}
      </div>
    </div>
  );
}

function MermaidPreview({
  state,
  onEdit,
}: {
  state: MermaidViewState;
  onEdit: () => void;
}) {
  const { t } = useTranslation();

  if (state.status === "ok") {
    return (
      <div
        className="kb-mermaid-diagram"
        // The SVG is produced by Mermaid with securityLevel "strict", which
        // sanitizes diagram labels, so it is safe to inject as markup.
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  if (state.status === "error") {
    return (
      <div className="kb-mermaid-error">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        <div className="kb-mermaid-error-body">
          <p className="kb-mermaid-error-title">{t("kb.editor.mermaid.error")}</p>
          <p className="kb-mermaid-error-message">{state.message}</p>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onEdit}
            className="kb-mermaid-error-action"
          >
            {t("kb.editor.mermaid.editSource")}
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="kb-mermaid-status">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("kb.editor.mermaid.rendering")}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onEdit}
      className="kb-mermaid-status kb-mermaid-empty"
    >
      {t("kb.editor.mermaid.empty")}
    </button>
  );
}

function KbMermaidBlock({ node }: Pick<NodeViewProps, "node">) {
  // AI- or user-authored diagrams open already rendered; a freshly inserted
  // (empty) block opens in code mode so the source area is focusable for typing.
  const [mode, setMode] = useState<ViewMode>(() =>
    node.textContent.trim().length > 0 ? "preview" : "code",
  );
  const state = useMermaidRender(node.textContent, mode === "preview");

  return (
    <NodeViewWrapper className="kb-mermaid" data-mode={mode}>
      <MermaidToolbar mode={mode} onModeChange={setMode} />

      <div className="kb-mermaid-preview" contentEditable={false} hidden={mode !== "preview"}>
        <MermaidPreview state={state} onEdit={() => setMode("code")} />
      </div>

      {/* The editable source stays mounted (only visually hidden in preview
          mode) so ProseMirror keeps a valid contentDOM and Markdown
          serialization continues to read the code block text. */}
      <pre className="kb-mermaid-source" hidden={mode !== "code"}>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

function KbCodeBlockView({ node }: NodeViewProps) {
  if (readLanguage(node.attrs.language) === MERMAID_LANGUAGE) {
    return <KbMermaidBlock node={node} />;
  }

  return (
    <NodeViewWrapper as="pre" className="kb-code-block">
      <NodeViewContent<"code"> as="code" />
    </NodeViewWrapper>
  );
}

/**
 * Code block that renders ```mermaid fences as live diagrams while keeping the
 * source editable. The node keeps the standard `codeBlock` name and `language`
 * attribute, so tiptap-markdown serializes it back to a fenced block unchanged.
 */
export const KbCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(KbCodeBlockView);
  },
});
