import {
  AlertTriangle,
  ExternalLink,
  FolderPlus,
  GitBranch,
  HardDrive,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type LayoutMode = "cards-current" | "dense-rows" | "master-detail" | "table";
type HeaderMode = "pills-bar" | "minimal-toolbar" | "inline-stats";
type GroupMode = "status-sections" | "recency-flat" | "kind-tabs";

interface ProposalOption<T extends string> {
  id: T;
  title: string;
  blurb: string;
  recommended?: boolean;
}

const LAYOUT_OPTIONS: readonly ProposalOption<LayoutMode>[] = [
  {
    id: "dense-rows",
    title: "Lista densa",
    blurb: "Linhas flat sem card/sombra. Status + título + meta. Estilo Codex/Cursor.",
    recommended: true,
  },
  {
    id: "master-detail",
    title: "Lista + detalhe",
    blurb: "Lista à esquerda, painel de sessões/ações à direita ao selecionar.",
  },
  {
    id: "table",
    title: "Tabela",
    blurb: "Colunas alinhadas: status · workspace · branch · atualizado · ações.",
  },
  {
    id: "cards-current",
    title: "Atual (cards)",
    blurb: "Cards com borda, sombra, hover lift e coluna de ações.",
  },
];

const HEADER_OPTIONS: readonly ProposalOption<HeaderMode>[] = [
  {
    id: "minimal-toolbar",
    title: "Toolbar mínima",
    blurb: "Título + contagem discreta + botões. Sem pills de inventário.",
    recommended: true,
  },
  {
    id: "inline-stats",
    title: "Stats inline",
    blurb: "Uma linha de texto: “14 trees · 1.2 GB · 80 MB reclaimable”.",
  },
  {
    id: "pills-bar",
    title: "Atual (pills)",
    blurb: "Barra com chips de inventário + New workspace + Cleanup.",
  },
];

const GROUP_OPTIONS: readonly ProposalOption<GroupMode>[] = [
  {
    id: "recency-flat",
    title: "Recência única",
    blurb: "Uma lista ordenada por atividade. Sem seções Active/Waiting.",
    recommended: true,
  },
  {
    id: "kind-tabs",
    title: "Abas por tipo",
    blurb: "All · Issues · Standalone · Orphans · Chats — filtra, não empilha seções.",
  },
  {
    id: "status-sections",
    title: "Atual (seções)",
    blurb: "Project / Active / Waiting / Orphans / Chats empilhados.",
  },
];

interface MockWorkspace {
  id: string;
  title: string;
  identifier?: string;
  kind: "project" | "issue" | "standalone" | "orphan";
  status: "active" | "waiting" | "idle" | "error";
  branch: string;
  size: string;
  updated: string;
  sessionLabel?: string;
  dirty?: boolean;
}

const MOCK_ROWS: readonly MockWorkspace[] = [
  {
    id: "project",
    title: "Project workspace",
    kind: "project",
    status: "idle",
    branch: "main",
    size: "420 MB",
    updated: "2h",
    sessionLabel: "Explore · 2h",
  },
  {
    id: "mm-14",
    title: "Shared order book depth feed",
    identifier: "MM-14",
    kind: "issue",
    status: "active",
    branch: "codex/mm-14-order-book",
    size: "86 MB",
    updated: "4m",
    sessionLabel: "Execution · 12 turns",
  },
  {
    id: "mm-9",
    title: "Implementar fluxo Polymarket omnibus",
    identifier: "MM-9",
    kind: "issue",
    status: "waiting",
    branch: "feat/polymarket-omnibus",
    size: "64 MB",
    updated: "1d",
    sessionLabel: "Authoring · yesterday",
    dirty: true,
  },
  {
    id: "standalone",
    title: "Spike: settlement latency",
    kind: "standalone",
    status: "idle",
    branch: "scratch/settlement",
    size: "12 MB",
    updated: "3d",
  },
  {
    id: "orphan",
    title: "orphan/old-mm-3",
    kind: "orphan",
    status: "idle",
    branch: "?",
    size: "31 MB",
    updated: "12d",
    dirty: true,
  },
];

export function WorkspacesPageLayoutProposalsPage() {
  const [layout, setLayout] = useState<LayoutMode>("dense-rows");
  const [header, setHeader] = useState<HeaderMode>("minimal-toolbar");
  const [group, setGroup] = useState<GroupMode>("recency-flat");

  const summary = useMemo(
    () => ({
      layout: LAYOUT_OPTIONS.find((o) => o.id === layout)!,
      header: HEADER_OPTIONS.find((o) => o.id === header)!,
      group: GROUP_OPTIONS.find((o) => o.id === group)!,
    }),
    [group, header, layout],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="space-y-2 border-b border-border pb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Design sandbox · workspaces page
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Propostas de layout — Workspaces
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Redesign de{" "}
          <code className="text-foreground">/projects/:slug/workspaces</code>. Escolha layout,
          header e agrupamento; o preview ao lado monta a combinação. Me diga os três IDs para
          implementarmos.
        </p>
      </header>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="space-y-8">
          <OptionGroup<LayoutMode>
            title="1. Layout da lista"
            options={LAYOUT_OPTIONS}
            value={layout}
            onChange={setLayout}
          />
          <OptionGroup<HeaderMode>
            title="2. Header / inventário"
            options={HEADER_OPTIONS}
            value={header}
            onChange={setHeader}
          />
          <OptionGroup<GroupMode>
            title="3. Agrupamento"
            options={GROUP_OPTIONS}
            value={group}
            onChange={setGroup}
          />
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            <div className="border-b border-border px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Preview · Macro Markets
              </span>
            </div>
            <div className="bg-muted/20 p-2">
              <MockWorkspacesPage layout={layout} header={header} group={group} />
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Seleção atual</p>
            <ul className="space-y-1">
              <li>
                Layout: <code className="text-foreground">{summary.layout.id}</code>
              </li>
              <li>
                Header: <code className="text-foreground">{summary.header.id}</code>
              </li>
              <li>
                Group: <code className="text-foreground">{summary.group.id}</code>
              </li>
            </ul>
            <p className="pt-1">
              Recomendação:{" "}
              <code className="text-foreground">dense-rows</code> +{" "}
              <code className="text-foreground">minimal-toolbar</code> +{" "}
              <code className="text-foreground">recency-flat</code>
            </p>
          </div>
        </aside>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Comparação rápida</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {LAYOUT_OPTIONS.map((option) => (
            <CompareCard
              key={option.id}
              title={`Layout · ${option.title}`}
              recommended={option.recommended}
              selected={layout === option.id}
              onSelect={() => setLayout(option.id)}
            >
              <MockWorkspacesPage
                layout={option.id}
                header="minimal-toolbar"
                group="recency-flat"
                compact
              />
            </CompareCard>
          ))}
          {HEADER_OPTIONS.map((option) => (
            <CompareCard
              key={option.id}
              title={`Header · ${option.title}`}
              recommended={option.recommended}
              selected={header === option.id}
              onSelect={() => setHeader(option.id)}
            >
              <MockWorkspacesPage
                layout="dense-rows"
                header={option.id}
                group="recency-flat"
                compact
              />
            </CompareCard>
          ))}
          {GROUP_OPTIONS.map((option) => (
            <CompareCard
              key={option.id}
              title={`Group · ${option.title}`}
              recommended={option.recommended}
              selected={group === option.id}
              onSelect={() => setGroup(option.id)}
            >
              <MockWorkspacesPage
                layout="dense-rows"
                header="minimal-toolbar"
                group={option.id}
                compact
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
      <div className="bg-muted/10 p-2">{children}</div>
    </button>
  );
}

function MockWorkspacesPage({
  layout,
  header,
  group,
  compact = false,
}: {
  layout: LayoutMode;
  header: HeaderMode;
  group: GroupMode;
  compact?: boolean;
}) {
  const [selectedId, setSelectedId] = useState("mm-14");
  const rows = MOCK_ROWS.slice(0, compact ? 3 : MOCK_ROWS.length);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border/70 bg-background",
        compact ? "min-h-[180px]" : "min-h-[360px]",
      )}
    >
      <div className="border-b border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground">
        Workspaces
      </div>
      <div className="space-y-2 p-2">
        <MockHeader mode={header} />
        {group === "kind-tabs" ? <MockKindTabs /> : null}
        {layout === "master-detail" ? (
          <div className={cn("grid gap-2", compact ? "grid-cols-1" : "grid-cols-[1fr_0.9fr]")}>
            <MockList
              layout="dense-rows"
              group={group}
              rows={rows}
              selectedId={selectedId}
              onSelect={setSelectedId}
              compact={compact}
            />
            {!compact ? (
              <MockDetailPane row={MOCK_ROWS.find((item) => item.id === selectedId) ?? MOCK_ROWS[1]} />
            ) : null}
          </div>
        ) : (
          <MockList
            layout={layout}
            group={group}
            rows={rows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            compact={compact}
          />
        )}
      </div>
    </div>
  );
}

function MockHeader({ mode }: { mode: HeaderMode }) {
  if (mode === "minimal-toolbar") {
    return (
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Workspaces</p>
          <p className="text-[11px] text-muted-foreground">5 trees · 613 MB</p>
        </div>
        <div className="flex items-center gap-1.5">
          <GhostButton icon={<FolderPlus className="h-3.5 w-3.5" />} label="New" />
          <GhostButton icon={<Trash2 className="h-3.5 w-3.5" />} label="Cleanup" />
        </div>
      </div>
    );
  }

  if (mode === "inline-stats") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-[11px]">
        <p className="text-muted-foreground">
          <span className="text-foreground">14 trees</span>
          <span className="mx-1.5 text-muted-foreground/40">·</span>
          1.2 GB
          <span className="mx-1.5 text-muted-foreground/40">·</span>
          <span className="text-emerald-700 dark:text-emerald-400">80 MB reclaimable</span>
        </p>
        <div className="flex items-center gap-1.5">
          <GhostButton icon={<FolderPlus className="h-3.5 w-3.5" />} label="New workspace" />
          <GhostButton icon={<Trash2 className="h-3.5 w-3.5" />} label="Cleanup" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/70 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
          Inventory
        </span>
        <Pill>5 trees</Pill>
        <Pill>613 MB</Pill>
        <Pill tone="emerald">80 MB reclaimable</Pill>
      </div>
      <div className="flex items-center gap-1.5">
        <GhostButton icon={<FolderPlus className="h-3.5 w-3.5" />} label="New workspace" />
        <GhostButton icon={<Trash2 className="h-3.5 w-3.5" />} label="Cleanup" />
      </div>
    </div>
  );
}

function MockKindTabs() {
  const tabs = ["All", "Issues", "Standalone", "Orphans", "Chats"] as const;
  return (
    <div className="flex flex-wrap gap-1 border-b border-border/50 pb-1.5">
      {tabs.map((tab, index) => (
        <span
          key={tab}
          className={cn(
            "rounded-md px-2 py-1 text-[11px]",
            index === 0
              ? "bg-foreground/[0.06] font-medium text-foreground"
              : "text-muted-foreground",
          )}
        >
          {tab}
        </span>
      ))}
    </div>
  );
}

function MockList({
  layout,
  group,
  rows,
  selectedId,
  onSelect,
  compact,
}: {
  layout: Exclude<LayoutMode, "master-detail"> | "dense-rows" | "cards-current" | "table";
  group: GroupMode;
  rows: readonly MockWorkspace[];
  selectedId: string;
  onSelect(id: string): void;
  compact: boolean;
}) {
  if (layout === "table") {
    return (
      <div className="overflow-hidden rounded-md border border-border/60">
        <div className="grid grid-cols-[16px_minmax(0,1.4fr)_minmax(0,1fr)_52px_28px] gap-2 border-b border-border/60 bg-muted/30 px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span />
          <span>Workspace</span>
          <span>Branch</span>
          <span>Updated</span>
          <span />
        </div>
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect(row.id)}
            className={cn(
              "grid w-full grid-cols-[16px_minmax(0,1.4fr)_minmax(0,1fr)_52px_28px] items-center gap-2 border-b border-border/40 px-2 py-2 text-left last:border-b-0",
              selectedId === row.id && "bg-foreground/[0.04]",
            )}
          >
            <StatusDot status={row.status} />
            <span className="min-w-0 truncate text-xs font-medium">
              {row.identifier ? (
                <span className="mr-1 font-mono text-[10px] text-muted-foreground">
                  {row.identifier}
                </span>
              ) : null}
              {row.title}
            </span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">{row.branch}</span>
            <span className="text-[10px] text-muted-foreground">{row.updated}</span>
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/60" />
          </button>
        ))}
      </div>
    );
  }

  if (layout === "cards-current") {
    const sections =
      group === "status-sections"
        ? [
            { title: "Project workspace", items: rows.filter((r) => r.kind === "project") },
            { title: "Active", items: rows.filter((r) => r.status === "active") },
            { title: "Waiting", items: rows.filter((r) => r.status === "waiting") },
          ]
        : [{ title: null, items: rows }];

    return (
      <div className="space-y-3">
        {sections.map((section) =>
          section.items.length === 0 ? null : (
            <div key={section.title ?? "all"}>
              {section.title ? (
                <h3 className="mb-1.5 px-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
                  {section.title}
                </h3>
              ) : null}
              <ul className="space-y-2">
                {section.items.map((row) => (
                  <li
                    key={row.id}
                    className="rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusDot status={row.status} />
                          {row.identifier ? (
                            <span className="font-mono text-[10px] font-semibold text-primary">
                              {row.identifier}
                            </span>
                          ) : null}
                          <span className="truncate text-xs font-semibold">{row.title}</span>
                          {row.kind === "standalone" ? <MiniBadge>Standalone</MiniBadge> : null}
                          {row.kind === "orphan" ? <MiniBadge tone="warning">Orphan</MiniBadge> : null}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Chip>
                            <GitBranch className="h-3 w-3" />
                            {row.branch}
                          </Chip>
                          <Chip>
                            <HardDrive className="h-3 w-3" />
                            {row.size}
                          </Chip>
                        </div>
                        {row.sessionLabel ? (
                          <div className="rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground">
                            {row.sessionLabel}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <GhostButton icon={<Plus className="h-3 w-3" />} label="Session" />
                        <span className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
      </div>
    );
  }

  // dense-rows (default)
  if (group === "status-sections") {
    const sections = [
      { title: "Project", items: rows.filter((r) => r.kind === "project") },
      { title: "Active", items: rows.filter((r) => r.status === "active") },
      { title: "Waiting", items: rows.filter((r) => r.status === "waiting") },
      {
        title: "Other",
        items: rows.filter((r) => r.kind !== "project" && r.status !== "active" && r.status !== "waiting"),
      },
    ];
    return (
      <div className="space-y-2">
        {sections.map((section) =>
          section.items.length === 0 ? null : (
            <div key={section.title}>
              <h3 className="mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.title}
              </h3>
              <DenseRows rows={section.items} selectedId={selectedId} onSelect={onSelect} />
            </div>
          ),
        )}
      </div>
    );
  }

  return <DenseRows rows={rows} selectedId={selectedId} onSelect={onSelect} />;
}

function DenseRows({
  rows,
  selectedId,
  onSelect,
}: {
  rows: readonly MockWorkspace[];
  selectedId: string;
  onSelect(id: string): void;
}) {
  return (
    <ul className="space-y-0.5">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => onSelect(row.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
              selectedId === row.id && "bg-black/[0.06] dark:bg-white/[0.08]",
            )}
          >
            <StatusDot status={row.status} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                {row.identifier ? (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {row.identifier}
                  </span>
                ) : null}
                <span className="truncate text-xs font-medium text-foreground">{row.title}</span>
                {row.kind === "orphan" ? (
                  <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
                ) : null}
                {row.dirty ? (
                  <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-400">dirty</span>
                ) : null}
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                <GitBranch className="h-3 w-3 shrink-0 opacity-60" />
                <span className="truncate font-mono">{row.branch}</span>
                <span className="text-muted-foreground/40">·</span>
                <span>{row.size}</span>
                {row.sessionLabel ? (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="truncate">{row.sessionLabel}</span>
                  </>
                ) : null}
              </span>
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{row.updated}</span>
            <MoreHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function MockDetailPane({ row }: { row: MockWorkspace }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">{row.title}</p>
          <p className="font-mono text-[10px] text-muted-foreground">{row.identifier ?? row.kind}</p>
        </div>
        <GhostButton icon={<Plus className="h-3 w-3" />} label="Session" />
      </div>
      <div className="space-y-1">
        <DetailSession
          icon={<MessageSquare className="h-3 w-3" />}
          label={row.sessionLabel ?? "No sessions"}
          meta={row.updated}
        />
        <DetailSession icon={<GitBranch className="h-3 w-3" />} label={row.branch} meta={row.size} />
      </div>
    </div>
  );
}

function DetailSession({
  icon,
  label,
  meta,
}: {
  icon: ReactNode;
  label: string;
  meta: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[11px] hover:bg-background/80">
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-foreground/90">{label}</span>
      <span className="text-muted-foreground">{meta}</span>
    </div>
  );
}

function StatusDot({ status }: { status: MockWorkspace["status"] }) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        status === "active" && "bg-emerald-500",
        status === "waiting" && "bg-amber-500",
        status === "idle" && "bg-muted-foreground/40",
        status === "error" && "bg-destructive",
      )}
    />
  );
}

function Pill({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "emerald";
}) {
  return (
    <span
      className={cn(
        "rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-foreground/80",
        tone === "emerald" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      {children}
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}

function MiniBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "warning";
}) {
  return (
    <span
      className={cn(
        "rounded border border-border/60 px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground",
        tone === "warning" && "border-amber-500/40 text-amber-700 dark:text-amber-400",
      )}
    >
      {children}
    </span>
  );
}

function GhostButton({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] text-foreground/80">
      {icon}
      {label}
    </span>
  );
}
