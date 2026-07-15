import { Archive, Check, FolderPlus, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ApproachId = "combined-sections" | "two-dialogs" | "mode-tabs";

interface ApproachOption {
  id: ApproachId;
  title: string;
  blurb: string;
  recommended?: boolean;
}

const APPROACHES: readonly ApproachOption[] = [
  {
    id: "combined-sections",
    title: "1 · Dialog combinado (2 seções)",
    blurb:
      "Botão Arquivar… ao lado de Limpar. Um dialog com Sessões (Arquivar / Excluir) + Trees (como o Limpar). Melhor para esvaziar o projeto de uma vez.",
    recommended: true,
  },
  {
    id: "two-dialogs",
    title: "2 · Dois botões / dois dialogs",
    blurb:
      "Arquivar… e Limpar… separados. Cada um foca numa coisa. Mais simples, mas dois fluxos para limpar tudo.",
  },
  {
    id: "mode-tabs",
    title: "3 · Um dialog com tabs",
    blurb:
      "Um botão Manter… abre dialog com tabs Arquivar · Excluir · Trees. Compacto, mas esconde a combinação sessão+tree.",
  },
];

const MOCK_SESSIONS = [
  { id: "s1", title: "Spike notes", meta: "CDE-1131 · há 2h", preselect: true },
  { id: "s2", title: "Sessão do projeto", meta: "project_session · há 1d", preselect: true },
  { id: "s3", title: "Review handoff", meta: "CDE-1139 · há 3d", preselect: false },
] as const;

const MOCK_TREES = [
  {
    id: "t1",
    title: "CDE-1131",
    path: "…/advising/CDE-1131",
    size: "2.0 GB",
    reclaimable: true,
    dirty: false,
  },
  {
    id: "t2",
    title: "CDE-1139",
    path: "…/advising/CDE-1139",
    size: "1.1 GB",
    reclaimable: false,
    dirty: true,
  },
  {
    id: "t3",
    title: "__ws_spike",
    path: "…/advising/__ws_spike",
    size: "80 MB",
    reclaimable: true,
    dirty: false,
  },
] as const;

export function WorkspaceArchiveCleanupProposalsPage() {
  const [approach, setApproach] = useState<ApproachId>("combined-sections");
  const [dialogOpen, setDialogOpen] = useState(true);
  const [activeTwoDialog, setActiveTwoDialog] = useState<"archive" | "cleanup">("archive");
  const [tab, setTab] = useState<"archive" | "delete" | "trees">("archive");
  const [selectedSessions, setSelectedSessions] = useState<ReadonlySet<string>>(
    () => new Set(MOCK_SESSIONS.filter((s) => s.preselect).map((s) => s.id)),
  );
  const [selectedTrees, setSelectedTrees] = useState<ReadonlySet<string>>(
    () => new Set(MOCK_TREES.filter((t) => t.reclaimable).map((t) => t.id)),
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const current = useMemo(
    () => APPROACHES.find((entry) => entry.id === approach)!,
    [approach],
  );

  function toggleSession(id: string) {
    setSelectedSessions((currentSet) => {
      const next = new Set(currentSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTree(id: string) {
    setSelectedTrees((currentSet) => {
      const next = new Set(currentSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="space-y-2 border-b border-border pb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Design sandbox · workspaces maintenance
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Mockups — Arquivar / Limpar / Excluir
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Simulação das 3 abordagens para{" "}
          <code className="text-foreground">/projects/:slug/workspaces</code>. Escolha uma opção à
          esquerda; o preview à direita mostra toolbar + dialog. Me diga o ID preferido para
          implementar.
        </p>
      </header>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,460px)]">
        <div className="space-y-3">
          {APPROACHES.map((option) => {
            const selected = option.id === approach;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setApproach(option.id);
                  setDialogOpen(true);
                  setDeleteConfirmOpen(false);
                  if (option.id === "two-dialogs") setActiveTwoDialog("archive");
                  if (option.id === "mode-tabs") setTab("archive");
                }}
                className={cn(
                  "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                  selected
                    ? "border-foreground/30 bg-muted/40"
                    : "border-border hover:border-foreground/20 hover:bg-muted/20",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{option.title}</p>
                      {option.recommended ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                          recomendado
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{option.blurb}</p>
                  </div>
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-transparent",
                    )}
                  >
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  </span>
                </div>
              </button>
            );
          })}

          <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Seleção atual</p>
            <p className="mt-1">
              Approach: <code className="text-foreground">{current.id}</code>
            </p>
            <p className="mt-2">
              URL desta sandbox:{" "}
              <code className="text-foreground">/tracker/dev/workspace-archive-cleanup-proposals</code>
            </p>
          </div>
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Preview · Advising
              </span>
              <button
                type="button"
                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setDialogOpen(true);
                  setDeleteConfirmOpen(false);
                }}
              >
                Reabrir dialog
              </button>
            </div>

            <div className="space-y-3 bg-muted/20 p-3">
              <MockToolbar
                approach={approach}
                onOpenArchive={() => {
                  setDialogOpen(true);
                  setDeleteConfirmOpen(false);
                  setActiveTwoDialog("archive");
                  setTab("archive");
                }}
                onOpenCleanup={() => {
                  setDialogOpen(true);
                  setDeleteConfirmOpen(false);
                  setActiveTwoDialog("cleanup");
                  setTab("trees");
                }}
                onOpenMaintain={() => {
                  setDialogOpen(true);
                  setDeleteConfirmOpen(false);
                  setTab("archive");
                }}
              />

              <div className="rounded-lg border border-dashed border-border/80 bg-background/80 px-3 py-6 text-center text-xs text-muted-foreground">
                Lista de workspaces (fora de escopo neste mock)
              </div>

              {dialogOpen ? (
                <div className="relative">
                  <div className="absolute inset-0 rounded-lg bg-foreground/10" aria-hidden />
                  <div className="relative mx-auto max-w-md rounded-xl border border-border bg-background p-4 shadow-lg">
                    {approach === "combined-sections" ? (
                      <CombinedSectionsDialog
                        selectedSessions={selectedSessions}
                        selectedTrees={selectedTrees}
                        onToggleSession={toggleSession}
                        onToggleTree={toggleTree}
                        deleteConfirmOpen={deleteConfirmOpen}
                        onRequestDelete={() => setDeleteConfirmOpen(true)}
                        onCancelDelete={() => setDeleteConfirmOpen(false)}
                        onClose={() => {
                          setDialogOpen(false);
                          setDeleteConfirmOpen(false);
                        }}
                      />
                    ) : null}

                    {approach === "two-dialogs" ? (
                      activeTwoDialog === "archive" ? (
                        <ArchiveOnlyDialog
                          selectedSessions={selectedSessions}
                          onToggleSession={toggleSession}
                          deleteConfirmOpen={deleteConfirmOpen}
                          onRequestDelete={() => setDeleteConfirmOpen(true)}
                          onCancelDelete={() => setDeleteConfirmOpen(false)}
                          onClose={() => {
                            setDialogOpen(false);
                            setDeleteConfirmOpen(false);
                          }}
                        />
                      ) : (
                        <TreesOnlyDialog
                          selectedTrees={selectedTrees}
                          onToggleTree={toggleTree}
                          onClose={() => setDialogOpen(false)}
                        />
                      )
                    ) : null}

                    {approach === "mode-tabs" ? (
                      <TabsDialog
                        tab={tab}
                        onTabChange={setTab}
                        selectedSessions={selectedSessions}
                        selectedTrees={selectedTrees}
                        onToggleSession={toggleSession}
                        onToggleTree={toggleTree}
                        deleteConfirmOpen={deleteConfirmOpen}
                        onRequestDelete={() => setDeleteConfirmOpen(true)}
                        onCancelDelete={() => setDeleteConfirmOpen(false)}
                        onClose={() => {
                          setDialogOpen(false);
                          setDeleteConfirmOpen(false);
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  Dialog fechado — use a toolbar ou “Reabrir dialog”.
                </p>
              )}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

function MockToolbar({
  approach,
  onOpenArchive,
  onOpenCleanup,
  onOpenMaintain,
}: {
  approach: ApproachId;
  onOpenArchive(): void;
  onOpenCleanup(): void;
  onOpenMaintain(): void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Workspaces</p>
        <p className="text-xs text-muted-foreground">18 trees · 26.7 GB</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <MockAction icon={<FolderPlus className="h-3.5 w-3.5" />} label="Novo workspace" />
        {approach === "mode-tabs" ? (
          <MockAction
            icon={<Archive className="h-3.5 w-3.5" />}
            label="Manter…"
            onClick={onOpenMaintain}
            emphasis
          />
        ) : (
          <>
            <MockAction
              icon={<Archive className="h-3.5 w-3.5" />}
              label="Arquivar…"
              onClick={onOpenArchive}
              emphasis
            />
            <MockAction
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Limpar"
              onClick={onOpenCleanup}
            />
          </>
        )}
      </div>
    </div>
  );
}

function MockAction({
  icon,
  label,
  onClick,
  emphasis = false,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
        emphasis
          ? "border-foreground/25 bg-foreground text-background"
          : "border-border/70 bg-background text-foreground hover:bg-muted/60",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function CombinedSectionsDialog({
  selectedSessions,
  selectedTrees,
  onToggleSession,
  onToggleTree,
  deleteConfirmOpen,
  onRequestDelete,
  onCancelDelete,
  onClose,
}: {
  selectedSessions: ReadonlySet<string>;
  selectedTrees: ReadonlySet<string>;
  onToggleSession(id: string): void;
  onToggleTree(id: string): void;
  deleteConfirmOpen: boolean;
  onRequestDelete(): void;
  onCancelDelete(): void;
  onClose(): void;
}) {
  return (
    <div className="space-y-3">
      <DialogChrome
        title="Arquivar e limpar"
        description="Arquive ou exclua sessões e, se quiser, remova working trees do disco."
      />

      {deleteConfirmOpen ? (
        <DeleteConfirmBanner count={selectedSessions.size} onCancel={onCancelDelete} />
      ) : (
        <>
          <SectionTitle>Sessões</SectionTitle>
          <CheckboxList>
            {MOCK_SESSIONS.map((session) => (
              <CheckboxRow
                key={session.id}
                checked={selectedSessions.has(session.id)}
                title={session.title}
                meta={session.meta}
                onToggle={() => onToggleSession(session.id)}
              />
            ))}
          </CheckboxList>

          <SectionTitle>Working trees</SectionTitle>
          <CheckboxList>
            {MOCK_TREES.map((tree) => (
              <CheckboxRow
                key={tree.id}
                checked={selectedTrees.has(tree.id)}
                title={tree.title}
                meta={`${tree.path} · ${tree.size}${tree.dirty ? " · dirty" : ""}`}
                onToggle={() => onToggleTree(tree.id)}
              />
            ))}
          </CheckboxList>
        </>
      )}

      <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        {!deleteConfirmOpen ? (
          <>
            <Button type="button" variant="outline" size="sm" disabled={selectedSessions.size === 0}>
              <Archive className="h-3.5 w-3.5" />
              Arquivar ({selectedSessions.size})
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={selectedSessions.size === 0}
              onClick={onRequestDelete}
            >
              Excluir…
            </Button>
            <Button type="button" variant="destructive" size="sm" disabled={selectedTrees.size === 0}>
              <Trash2 className="h-3.5 w-3.5" />
              Remover trees ({selectedTrees.size})
            </Button>
          </>
        ) : (
          <Button type="button" variant="destructive" size="sm">
            Confirmar exclusão ({selectedSessions.size})
          </Button>
        )}
      </div>
    </div>
  );
}

function ArchiveOnlyDialog({
  selectedSessions,
  onToggleSession,
  deleteConfirmOpen,
  onRequestDelete,
  onCancelDelete,
  onClose,
}: {
  selectedSessions: ReadonlySet<string>;
  onToggleSession(id: string): void;
  deleteConfirmOpen: boolean;
  onRequestDelete(): void;
  onCancelDelete(): void;
  onClose(): void;
}) {
  return (
    <div className="space-y-3">
      <DialogChrome
        title="Arquivar sessões"
        description="Só sessões/chats. Trees ficam — use Limpar… para disco."
      />
      {deleteConfirmOpen ? (
        <DeleteConfirmBanner count={selectedSessions.size} onCancel={onCancelDelete} />
      ) : (
        <CheckboxList>
          {MOCK_SESSIONS.map((session) => (
            <CheckboxRow
              key={session.id}
              checked={selectedSessions.has(session.id)}
              title={session.title}
              meta={session.meta}
              onToggle={() => onToggleSession(session.id)}
            />
          ))}
        </CheckboxList>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        {!deleteConfirmOpen ? (
          <>
            <Button type="button" variant="outline" size="sm" disabled={selectedSessions.size === 0}>
              Arquivar ({selectedSessions.size})
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={selectedSessions.size === 0}
              onClick={onRequestDelete}
            >
              Excluir…
            </Button>
          </>
        ) : (
          <Button type="button" variant="destructive" size="sm">
            Confirmar exclusão
          </Button>
        )}
      </div>
    </div>
  );
}

function TreesOnlyDialog({
  selectedTrees,
  onToggleTree,
  onClose,
}: {
  selectedTrees: ReadonlySet<string>;
  onToggleTree(id: string): void;
  onClose(): void;
}) {
  return (
    <div className="space-y-3">
      <DialogChrome
        title="Limpar working trees"
        description="Trees órfãs sem trabalho não publicado vêm pré-selecionadas."
      />
      <CheckboxList>
        {MOCK_TREES.map((tree) => (
          <CheckboxRow
            key={tree.id}
            checked={selectedTrees.has(tree.id)}
            title={tree.title}
            meta={`${tree.path} · ${tree.size}`}
            onToggle={() => onToggleTree(tree.id)}
          />
        ))}
      </CheckboxList>
      <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="button" variant="destructive" size="sm" disabled={selectedTrees.size === 0}>
          Remover selecionados
        </Button>
      </div>
    </div>
  );
}

function TabsDialog({
  tab,
  onTabChange,
  selectedSessions,
  selectedTrees,
  onToggleSession,
  onToggleTree,
  deleteConfirmOpen,
  onRequestDelete,
  onCancelDelete,
  onClose,
}: {
  tab: "archive" | "delete" | "trees";
  onTabChange(tab: "archive" | "delete" | "trees"): void;
  selectedSessions: ReadonlySet<string>;
  selectedTrees: ReadonlySet<string>;
  onToggleSession(id: string): void;
  onToggleTree(id: string): void;
  deleteConfirmOpen: boolean;
  onRequestDelete(): void;
  onCancelDelete(): void;
  onClose(): void;
}) {
  return (
    <div className="space-y-3">
      <DialogChrome
        title="Manter workspaces"
        description="Escolha o modo: arquivar, excluir sessões ou limpar trees."
      />
      <div className="flex gap-1 rounded-md border border-border/70 bg-muted/30 p-0.5">
        {(
          [
            ["archive", "Arquivar"],
            ["delete", "Excluir"],
            ["trees", "Trees"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              onTabChange(id);
              onCancelDelete();
            }}
            className={cn(
              "flex-1 rounded-sm px-2 py-1 text-xs font-medium",
              tab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "trees" ? (
        <CheckboxList>
          {MOCK_TREES.map((tree) => (
            <CheckboxRow
              key={tree.id}
              checked={selectedTrees.has(tree.id)}
              title={tree.title}
              meta={`${tree.path} · ${tree.size}`}
              onToggle={() => onToggleTree(tree.id)}
            />
          ))}
        </CheckboxList>
      ) : deleteConfirmOpen && tab === "delete" ? (
        <DeleteConfirmBanner count={selectedSessions.size} onCancel={onCancelDelete} />
      ) : (
        <CheckboxList>
          {MOCK_SESSIONS.map((session) => (
            <CheckboxRow
              key={session.id}
              checked={selectedSessions.has(session.id)}
              title={session.title}
              meta={session.meta}
              onToggle={() => onToggleSession(session.id)}
            />
          ))}
        </CheckboxList>
      )}

      <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        {tab === "archive" ? (
          <Button type="button" size="sm" disabled={selectedSessions.size === 0}>
            Arquivar ({selectedSessions.size})
          </Button>
        ) : null}
        {tab === "delete" ? (
          deleteConfirmOpen ? (
            <Button type="button" variant="destructive" size="sm">
              Confirmar exclusão
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={selectedSessions.size === 0}
              onClick={onRequestDelete}
            >
              Excluir…
            </Button>
          )
        ) : null}
        {tab === "trees" ? (
          <Button type="button" variant="destructive" size="sm" disabled={selectedTrees.size === 0}>
            Remover trees ({selectedTrees.size})
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DialogChrome({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function CheckboxList({ children }: { children: ReactNode }) {
  return <ul className="max-h-40 space-y-1.5 overflow-y-auto">{children}</ul>;
}

function CheckboxRow({
  checked,
  title,
  meta,
  onToggle,
}: {
  checked: boolean;
  title: string;
  meta: string;
  onToggle(): void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-primary"
          checked={checked}
          onChange={onToggle}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{meta}</span>
        </span>
      </label>
    </li>
  );
}

function DeleteConfirmBanner({ count, onCancel }: { count: number; onCancel(): void }) {
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
      <p className="text-xs font-medium text-destructive">
        Excluir permanentemente {count} sessão(ões)?
      </p>
      <p className="text-[11px] text-muted-foreground">
        Apaga histórico, logs e anexos da thread. Não pode ser desfeito. Trees no disco não são
        removidas por esta ação.
      </p>
      <button
        type="button"
        className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        onClick={onCancel}
      >
        Voltar à seleção
      </button>
    </div>
  );
}
