import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  MessageSquare,
  Plus,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type IconMode = "chevron-folder" | "chevron-only" | "folder-only";
type LoadingMode = "double" | "parent-icon" | "child-row" | "chevron-spin";
type EmptyMode = "boxed-loud" | "soft-inline" | "ghost-create" | "none-parent-hint";

interface ProposalOption<T extends string> {
  id: T;
  title: string;
  blurb: string;
  recommended?: boolean;
}

const ICON_OPTIONS: readonly ProposalOption<IconMode>[] = [
  {
    id: "chevron-only",
    title: "Só seta",
    blurb: "Chevron abre/fecha. Sem pasta. Mais limpo, estilo Codex/Cursor.",
    recommended: true,
  },
  {
    id: "folder-only",
    title: "Só pasta",
    blurb: "Pasta aberta/fechada indica expand. Sem seta. Mais “arquivo”.",
  },
  {
    id: "chevron-folder",
    title: "Atual (seta + pasta)",
    blurb: "Dois affordances no mesmo lugar — o que você marcou como demais.",
  },
];

const LOADING_OPTIONS: readonly ProposalOption<LoadingMode>[] = [
  {
    id: "parent-icon",
    title: "Spinner no pai",
    blurb: "Só o ícone do projeto gira. Sem linha filha de loading.",
    recommended: true,
  },
  {
    id: "child-row",
    title: "Linha filha discreta",
    blurb: "Pasta do pai fica quieta; uma linha fina com spinner sob o projeto.",
  },
  {
    id: "chevron-spin",
    title: "Spinner na seta",
    blurb: "A seta vira spinner enquanto carrega. Ícone de pasta estável.",
  },
  {
    id: "double",
    title: "Atual (dois spinners)",
    blurb: "Spinner no ícone do projeto + spinner na linha filha.",
  },
];

const EMPTY_OPTIONS: readonly ProposalOption<EmptyMode>[] = [
  {
    id: "soft-inline",
    title: "Linha suave",
    blurb: "“Sem sessões” em muted + ação “Criar” ao lado. Sem caixa.",
    recommended: true,
  },
  {
    id: "ghost-create",
    title: "Só criar",
    blurb: "Uma linha ghost “+ Nova sessão”. Sem texto de vazio.",
  },
  {
    id: "none-parent-hint",
    title: "Hint no pai",
    blurb: "Workspace sem filhos; contador 0 e nada abaixo. Criar via menu.",
  },
  {
    id: "boxed-loud",
    title: "Atual (caixa uppercase)",
    blurb: "Caixa cinza com título longo em caps + CTA com nome do workspace.",
  },
];

export function SidebarTreeLayoutProposalsPage() {
  const [iconMode, setIconMode] = useState<IconMode>("chevron-only");
  const [loadingMode, setLoadingMode] = useState<LoadingMode>("parent-icon");
  const [emptyMode, setEmptyMode] = useState<EmptyMode>("soft-inline");

  const summary = useMemo(
    () => ({
      icon: ICON_OPTIONS.find((o) => o.id === iconMode)!,
      loading: LOADING_OPTIONS.find((o) => o.id === loadingMode)!,
      empty: EMPTY_OPTIONS.find((o) => o.id === emptyMode)!,
    }),
    [emptyMode, iconMode, loadingMode],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="space-y-2 border-b border-border pb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Design sandbox · sidebar tree
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Propostas de layout da árvore
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Compare as opções abaixo. A seleção atual monta o mock da direita — escolha uma
          combinação e me diga os três IDs (ícones / loading / empty) para implementarmos no
          tree real.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-8">
          <OptionGroup<IconMode>
            title="1. Ícones de expand"
            options={ICON_OPTIONS}
            value={iconMode}
            onChange={setIconMode}
          />
          <OptionGroup<LoadingMode>
            title="2. Loading"
            options={LOADING_OPTIONS}
            value={loadingMode}
            onChange={setLoadingMode}
          />
          <OptionGroup<EmptyMode>
            title="3. Empty de sessão"
            options={EMPTY_OPTIONS}
            value={emptyMode}
            onChange={setEmptyMode}
          />
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Projetos
              </span>
              <span className="text-[11px] text-muted-foreground">Filtros</span>
            </div>
            <div className="p-1.5">
              <MockSidebarTree
                iconMode={iconMode}
                loadingMode={loadingMode}
                emptyMode={emptyMode}
              />
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Seleção atual</p>
            <ul className="space-y-1">
              <li>
                Ícones: <code className="text-foreground">{summary.icon.id}</code>
              </li>
              <li>
                Loading: <code className="text-foreground">{summary.loading.id}</code>
              </li>
              <li>
                Empty: <code className="text-foreground">{summary.empty.id}</code>
              </li>
            </ul>
            <p className="pt-1">
              Recomendação:{" "}
              <code className="text-foreground">chevron-only</code> +{" "}
              <code className="text-foreground">parent-icon</code> +{" "}
              <code className="text-foreground">soft-inline</code>
            </p>
          </div>
        </aside>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Comparação rápida (todas as opções)</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ICON_OPTIONS.map((option) => (
            <CompareCard
              key={option.id}
              title={`Ícones · ${option.title}`}
              recommended={option.recommended}
              selected={iconMode === option.id}
              onSelect={() => setIconMode(option.id)}
            >
              <MockSidebarTree
                iconMode={option.id}
                loadingMode="parent-icon"
                emptyMode="soft-inline"
                compact
              />
            </CompareCard>
          ))}
          {LOADING_OPTIONS.map((option) => (
            <CompareCard
              key={option.id}
              title={`Loading · ${option.title}`}
              recommended={option.recommended}
              selected={loadingMode === option.id}
              onSelect={() => setLoadingMode(option.id)}
            >
              <MockSidebarTree
                iconMode="chevron-only"
                loadingMode={option.id}
                emptyMode="soft-inline"
                compact
                focus="loading"
              />
            </CompareCard>
          ))}
          {EMPTY_OPTIONS.map((option) => (
            <CompareCard
              key={option.id}
              title={`Empty · ${option.title}`}
              recommended={option.recommended}
              selected={emptyMode === option.id}
              onSelect={() => setEmptyMode(option.id)}
            >
              <MockSidebarTree
                iconMode="chevron-only"
                loadingMode="parent-icon"
                emptyMode={option.id}
                compact
                focus="empty"
              />
            </CompareCard>
          ))}
        </div>
      </section>
    </div>
  );
}

function OptionGroup<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: readonly ProposalOption<T>[];
  value: T;
  onChange(next: T): void;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                selected
                  ? "border-foreground/30 bg-foreground/[0.04]"
                  : "border-border hover:bg-muted/40",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{option.title}</span>
                {option.recommended ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    recomendado
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{option.blurb}</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">{option.id}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CompareCard({
  title,
  recommended,
  selected,
  onSelect,
  children,
}: {
  title: string;
  recommended?: boolean;
  selected: boolean;
  onSelect(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "overflow-hidden rounded-xl border text-left transition-colors",
        selected ? "border-foreground/40 ring-1 ring-foreground/20" : "border-border",
      )}
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/20 px-3 py-2">
        <span className="text-xs font-medium text-foreground">{title}</span>
        {recommended ? (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">rec</span>
        ) : null}
      </div>
      <div className="bg-background p-1.5">{children}</div>
    </button>
  );
}

function MockSidebarTree({
  iconMode,
  loadingMode,
  emptyMode,
  compact = false,
  focus = "all",
}: {
  iconMode: IconMode;
  loadingMode: LoadingMode;
  emptyMode: EmptyMode;
  compact?: boolean;
  focus?: "all" | "loading" | "empty";
}) {
  const showLoading = focus === "all" || focus === "loading";
  const showEmpty = focus === "all" || focus === "empty";

  return (
    <div
      className={cn("space-y-0.5", compact ? "min-h-[140px]" : "min-h-[220px]")}
      role="presentation"
    >
      {showLoading ? (
        <MockProjectRow
          title="Macro Markets"
          count={14}
          expanded
          loading
          iconMode={iconMode}
          loadingMode={loadingMode}
        >
          {loadingMode === "double" || loadingMode === "child-row" ? (
            <MockChildSpinner indent={28} />
          ) : null}
          {loadingMode === "parent-icon" || loadingMode === "chevron-spin" ? (
            <MockWorkspaceRow
              title="Shared order book…"
              iconMode={iconMode}
              indent={14}
              muted
            />
          ) : null}
        </MockProjectRow>
      ) : null}

      {showEmpty ? (
        <MockProjectRow
          title="Tenant market catalog"
          count={1}
          expanded
          iconMode={iconMode}
          loadingMode="parent-icon"
        >
          <MockWorkspaceRow
            title="Implementar fluxo Polymarket omnibus…"
            expanded
            iconMode={iconMode}
            indent={14}
            count={emptyMode === "none-parent-hint" ? 0 : undefined}
          >
            <MockEmptySession emptyMode={emptyMode} workspaceTitle="Implementar fluxo Polymarket omnibus/pass-through no backend" />
          </MockWorkspaceRow>
        </MockProjectRow>
      ) : null}

      {!compact ? (
        <MockProjectRow
          title="Dev10x"
          count={3}
          iconMode={iconMode}
          loadingMode="parent-icon"
        />
      ) : null}
    </div>
  );
}

function MockProjectRow({
  title,
  count,
  expanded = false,
  loading = false,
  iconMode,
  loadingMode,
  children,
}: {
  title: string;
  count?: number;
  expanded?: boolean;
  loading?: boolean;
  iconMode: IconMode;
  loadingMode: LoadingMode;
  children?: ReactNode;
}) {
  const showChevron = iconMode !== "folder-only";
  const showFolder = iconMode !== "chevron-only";
  const FolderIcon = expanded ? FolderOpen : Folder;
  const chevronIsSpinner = loading && loadingMode === "chevron-spin";
  const iconIsSpinner =
    loading && (loadingMode === "parent-icon" || loadingMode === "double");

  return (
    <div>
      <div className="mx-0.5 flex min-h-9 items-center gap-0.5 rounded-md py-1 pr-1 text-sm">
        {showChevron ? (
          <span className="inline-flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground/60">
            {chevronIsSpinner ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : expanded ? (
              <ChevronDown className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden />
            )}
          </span>
        ) : (
          <span className="w-1 shrink-0" />
        )}
        <span className="flex min-w-0 flex-1 items-center gap-2 px-1">
          {showFolder || iconIsSpinner ? (
            <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
              {iconIsSpinner ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/70" aria-hidden />
              ) : (
                <FolderIcon className="h-4 w-4" aria-hidden />
              )}
              {!loading ? (
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
              ) : null}
            </span>
          ) : (
            <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
          {typeof count === "number" ? (
            <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
          ) : null}
        </span>
      </div>
      {expanded ? children : null}
    </div>
  );
}

function MockWorkspaceRow({
  title,
  expanded = false,
  iconMode,
  indent,
  count,
  muted = false,
  children,
}: {
  title: string;
  expanded?: boolean;
  iconMode: IconMode;
  indent: number;
  count?: number;
  muted?: boolean;
  children?: ReactNode;
}) {
  const showChevron = iconMode !== "folder-only";
  const showFolder = iconMode !== "chevron-only";
  const FolderIcon = expanded ? FolderOpen : Folder;

  return (
    <div>
      <div
        className={cn(
          "mx-0.5 flex min-h-9 items-center gap-0.5 rounded-md py-1 pr-1 text-sm",
          muted && "opacity-50",
        )}
        style={{ paddingLeft: `${indent}px` }}
      >
        {showChevron ? (
          <span className="inline-flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground/60">
            {expanded ? (
              <ChevronDown className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden />
            )}
          </span>
        ) : (
          <span className="w-1 shrink-0" />
        )}
        <span className="flex min-w-0 flex-1 items-center gap-2 px-1">
          {showFolder ? (
            <span className="relative inline-flex h-4 w-4 shrink-0 text-muted-foreground">
              <FolderIcon className="h-4 w-4" aria-hidden />
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-sky-500" />
            </span>
          ) : (
            <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
          {typeof count === "number" ? (
            <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
          ) : null}
        </span>
      </div>
      {expanded ? children : null}
    </div>
  );
}

function MockChildSpinner({ indent }: { indent: number }) {
  return (
    <div
      className="mx-0.5 flex h-7 items-center"
      style={{ paddingLeft: `${indent}px` }}
      aria-hidden
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />
    </div>
  );
}

function MockEmptySession({
  emptyMode,
  workspaceTitle,
}: {
  emptyMode: EmptyMode;
  workspaceTitle: string;
}) {
  if (emptyMode === "none-parent-hint") return null;

  if (emptyMode === "boxed-loud") {
    return (
      <div
        className="mx-2 my-2 rounded-lg bg-black/[0.03] px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground dark:bg-white/[0.04]"
        style={{ marginLeft: "26px" }}
      >
        <p>Nenhuma sessão em {workspaceTitle}.</p>
        <button
          type="button"
          className="mt-1 rounded px-1.5 py-1 font-medium normal-case tracking-normal text-foreground hover:bg-muted"
        >
          Criar sessão em {workspaceTitle}.
        </button>
      </div>
    );
  }

  if (emptyMode === "ghost-create") {
    return (
      <div
        className="mx-0.5 flex min-h-8 items-center gap-2 rounded-md px-1 py-0.5 text-sm text-muted-foreground hover:bg-black/[0.04]"
        style={{ paddingLeft: "40px" }}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        <span>Nova sessão</span>
      </div>
    );
  }

  return (
    <div
      className="mx-0.5 flex min-h-8 items-center gap-2 rounded-md px-1 py-0.5 text-sm"
      style={{ paddingLeft: "40px" }}
    >
      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/40" aria-hidden />
      <span className="text-muted-foreground/80">Sem sessões</span>
      <span className="text-muted-foreground/40">·</span>
      <button type="button" className="text-foreground/80 hover:underline">
        Criar
      </button>
    </div>
  );
}
