import {
  ChevronDown,
  GitBranch,
  GitCompare,
  HardDrive,
  MessageSquare,
  Mic,
  Plus,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type FeedMode = "timeline-current" | "codex-chat" | "hybrid";
type ScrollMode = "nested-current" | "single-feed" | "single-feed-wide";
type ChromeMode = "card-shadow" | "flat-border" | "borderless";
type ComposerMode = "toolbar-dense" | "floating-pill" | "split-minimal";
type RightPanelMode = "closed" | "floating-dock" | "fixed-column";

interface ProposalOption<T extends string> {
  id: T;
  title: string;
  blurb: string;
  recommended?: boolean;
}

const FEED_OPTIONS: readonly ProposalOption<FeedMode>[] = [
  {
    id: "codex-chat",
    title: "Codex chat",
    blurb: "User bubble à direita; agent solto à esquerda; “Worked for…” discreto.",
    recommended: true,
  },
  {
    id: "hybrid",
    title: "Híbrido",
    blurb: "Chat para texto; tools em rows compactas colapsadas. Densidade de execução + ar Codex.",
  },
  {
    id: "timeline-current",
    title: "Atual (timeline)",
    blurb: "Rows RODOU / tool cards empilhadas — o que polui com muitos comandos.",
  },
];

const SCROLL_OPTIONS: readonly ProposalOption<ScrollMode>[] = [
  {
    id: "single-feed",
    title: "Um scroll",
    blurb: "Só o feed rola. Composer fixo embaixo. Sem scroll no card externo.",
    recommended: true,
  },
  {
    id: "single-feed-wide",
    title: "Um scroll · wide",
    blurb: "Igual, mas feed usa quase toda a largura (sem max-w apertado).",
  },
  {
    id: "nested-current",
    title: "Atual (aninhado)",
    blurb: "Card → painel → lista → tool output — várias barras.",
  },
];

const CHROME_OPTIONS: readonly ProposalOption<ChromeMode>[] = [
  {
    id: "borderless",
    title: "Sem card",
    blurb: "Sem borda/sombra no container. Flat sobre o fundo — estilo Codex.",
    recommended: true,
  },
  {
    id: "flat-border",
    title: "Borda fina",
    blurb: "Um contorno discreto, sem sombra nem gradiente.",
  },
  {
    id: "card-shadow",
    title: "Atual (card)",
    blurb: "rounded-xl + border + shadow + padding interno.",
  },
];

const COMPOSER_OPTIONS: readonly ProposalOption<ComposerMode>[] = [
  {
    id: "split-minimal",
    title: "Mínimo + overflow",
    blurb: "Linha de input limpa; toggles avançados em “⋯”.",
    recommended: true,
  },
  {
    id: "floating-pill",
    title: "Pill flutuante",
    blurb: "Barra arredondada; Diff/KB/Yolo viram menu +. Menos chips na cara.",
  },
  {
    id: "toolbar-dense",
    title: "Atual (denso)",
    blurb: "+ Diff KB Yolo Skills Autônomo Mágico — tudo visível.",
  },
];

const RIGHT_PANEL_OPTIONS: readonly ProposalOption<RightPanelMode>[] = [
  {
    id: "floating-dock",
    title: "Dock flutuante",
    blurb: "Painel Environment/Sources flutuante à direita (screenshot Codex).",
    recommended: true,
  },
  {
    id: "fixed-column",
    title: "Coluna fixa",
    blurb: "Coluna sempre aberta; feed encolhe.",
  },
  {
    id: "closed",
    title: "Fechado",
    blurb: "Sem painel; git/diff ficam na toolbar da sessão.",
  },
];

export function AssistantSessionLayoutProposalsPage() {
  const [feed, setFeed] = useState<FeedMode>("codex-chat");
  const [scroll, setScroll] = useState<ScrollMode>("single-feed");
  const [chrome, setChrome] = useState<ChromeMode>("borderless");
  const [composer, setComposer] = useState<ComposerMode>("split-minimal");
  const [rightPanel, setRightPanel] = useState<RightPanelMode>("floating-dock");

  const summary = useMemo(
    () => ({
      feed: FEED_OPTIONS.find((o) => o.id === feed)!,
      scroll: SCROLL_OPTIONS.find((o) => o.id === scroll)!,
      chrome: CHROME_OPTIONS.find((o) => o.id === chrome)!,
      composer: COMPOSER_OPTIONS.find((o) => o.id === composer)!,
      rightPanel: RIGHT_PANEL_OPTIONS.find((o) => o.id === rightPanel)!,
    }),
    [chrome, composer, feed, rightPanel, scroll],
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-8 p-6">
      <header className="space-y-2 border-b border-border pb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Design sandbox · assistant session
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Propostas de layout — Assistant (workspaces?exec=)
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Seleção parcial:{" "}
          <code className="text-foreground">codex-chat</code> +{" "}
          <code className="text-foreground">single-feed</code> +{" "}
          <code className="text-foreground">borderless</code>. Abaixo, vista isolada do chrome com
          o shell completo (header · tabs · sessão) e todos os eixos atuais.
        </p>
        <div className="flex flex-wrap gap-2 pt-1 text-[11px] text-muted-foreground">
          <LockChip label="feed" value={summary.feed.id} locked />
          <LockChip label="scroll" value={summary.scroll.id} locked />
          <LockChip label="chrome" value={summary.chrome.id} locked />
          <LockChip label="composer" value={summary.composer.id} locked />
          <LockChip label="rightPanel" value={summary.rightPanel.id} locked />
        </div>
      </header>

      <section id="composer-isolated" className="scroll-mt-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Vista isolada · composer (A / B / C)
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Simulação ampliada das 3 opções — feed curto + composer em destaque. Clique para
              selecionar.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COMPOSER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setComposer(option.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  composer === option.id
                    ? "border-foreground/40 bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/50",
                )}
              >
                {option.title}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          {COMPOSER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setComposer(option.id)}
              className={cn(
                "overflow-hidden rounded-xl border text-left transition-colors",
                composer === option.id
                  ? "border-foreground/40 ring-1 ring-foreground/20"
                  : "border-border hover:bg-muted/10",
              )}
            >
              <div className="flex items-center justify-between border-b border-border bg-muted/20 px-3 py-2">
                <span className="text-xs font-medium text-foreground">
                  Composer · {option.title}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">{option.id}</span>
              </div>
              <div className="bg-muted/30 p-3">
                <ComposerShowcase mode={option.id} selected={composer === option.id} />
              </div>
              <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                {option.blurb}
                {option.recommended ? (
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-foreground/70">
                    · rec
                  </span>
                ) : null}
              </p>
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Composer selecionado · zoom
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">{composer}</span>
          </div>
          <div className="bg-muted/25 p-4 sm:p-6">
            <ComposerShowcase mode={composer} selected zoom />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Vista isolada · chrome (shell completo)
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Mesmo feed/scroll/chrome travados. Troque composer / painel — o stage grande
              atualiza na hora.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CHROME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setChrome(option.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  chrome === option.id
                    ? "border-foreground/40 bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/50",
                )}
              >
                {option.title}
              </button>
            ))}
          </div>
        </div>

        <IsolatedWorkspaceStage
          feed={feed}
          scroll={scroll}
          chrome={chrome}
          composer={composer}
          rightPanel={rightPanel}
        />

        <div className="grid gap-3 lg:grid-cols-3">
          {CHROME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setChrome(option.id)}
              className={cn(
                "overflow-hidden rounded-xl border text-left transition-colors",
                chrome === option.id
                  ? "border-foreground/40 ring-1 ring-foreground/20"
                  : "border-border hover:bg-muted/20",
              )}
            >
              <div className="flex items-center justify-between border-b border-border bg-muted/20 px-3 py-2">
                <span className="text-xs font-medium text-foreground">Chrome · {option.title}</span>
                {option.recommended ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    rec
                  </span>
                ) : null}
              </div>
              <div className="bg-muted/25 p-1.5">
                <IsolatedWorkspaceStage
                  feed={feed}
                  scroll={scroll}
                  chrome={option.id}
                  composer={composer}
                  rightPanel={rightPanel}
                  compact
                />
              </div>
              <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                {option.blurb}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-8">
          <OptionGroup<FeedMode>
            title="1. Estilo do feed"
            options={FEED_OPTIONS}
            value={feed}
            onChange={setFeed}
          />
          <OptionGroup<ScrollMode>
            title="2. Scroll / layout"
            options={SCROLL_OPTIONS}
            value={scroll}
            onChange={setScroll}
          />
          <OptionGroup<ChromeMode>
            title="3. Chrome do container"
            options={CHROME_OPTIONS}
            value={chrome}
            onChange={setChrome}
          />
          <OptionGroup<ComposerMode>
            title="4. Composer"
            options={COMPOSER_OPTIONS}
            value={composer}
            onChange={setComposer}
          />
          <OptionGroup<RightPanelMode>
            title="5. Painel direito (Environment)"
            options={RIGHT_PANEL_OPTIONS}
            value={rightPanel}
            onChange={setRightPanel}
          />
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Preview compacto · MAC-7
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {summary.feed.id} · {summary.chrome.id}
              </span>
            </div>
            <div className="bg-muted/30 p-2">
              <MockAssistantSession
                feed={feed}
                scroll={scroll}
                chrome={chrome}
                composer={composer}
                rightPanel={rightPanel}
              />
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Seleção atual</p>
            <ul className="space-y-1 font-mono">
              <li>
                feed: <span className="text-foreground">{summary.feed.id}</span>
              </li>
              <li>
                scroll: <span className="text-foreground">{summary.scroll.id}</span>
              </li>
              <li>
                chrome: <span className="text-foreground">{summary.chrome.id}</span>
              </li>
              <li>
                composer: <span className="text-foreground">{summary.composer.id}</span>
              </li>
              <li>
                rightPanel: <span className="text-foreground">{summary.rightPanel.id}</span>
              </li>
            </ul>
            <p className="pt-1">
              Final:{" "}
              <code className="text-foreground">codex-chat</code> +{" "}
              <code className="text-foreground">single-feed</code> +{" "}
              <code className="text-foreground">borderless</code> +{" "}
              <code className="text-foreground">split-minimal</code> +{" "}
              <code className="text-foreground">floating-dock</code>
            </p>
          </div>
        </aside>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Comparação rápida · estilo do feed (A / B / C)
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {FEED_OPTIONS.map((option) => (
            <CompareCard
              key={option.id}
              title={`Feed · ${option.title}`}
              recommended={option.recommended}
              selected={feed === option.id}
              onSelect={() => setFeed(option.id)}
            >
              <MockAssistantSession
                feed={option.id}
                scroll="single-feed"
                chrome="borderless"
                composer="floating-pill"
                rightPanel="closed"
                compact
              />
            </CompareCard>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Outros eixos</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {SCROLL_OPTIONS.map((option) => (
            <CompareCard
              key={option.id}
              title={`Scroll · ${option.title}`}
              recommended={option.recommended}
              selected={scroll === option.id}
              onSelect={() => setScroll(option.id)}
            >
              <MockScrollHint mode={option.id} />
            </CompareCard>
          ))}
          {CHROME_OPTIONS.map((option) => (
            <CompareCard
              key={option.id}
              title={`Chrome · ${option.title}`}
              recommended={option.recommended}
              selected={chrome === option.id}
              onSelect={() => setChrome(option.id)}
            >
              <MockChromeHint mode={option.id} />
            </CompareCard>
          ))}
          {COMPOSER_OPTIONS.map((option) => (
            <CompareCard
              key={option.id}
              title={`Composer · ${option.title}`}
              recommended={option.recommended}
              selected={composer === option.id}
              onSelect={() => setComposer(option.id)}
            >
              <MockComposer mode={option.id} size="md" />
            </CompareCard>
          ))}
          {RIGHT_PANEL_OPTIONS.map((option) => (
            <CompareCard
              key={option.id}
              title={`Right · ${option.title}`}
              recommended={option.recommended}
              selected={rightPanel === option.id}
              onSelect={() => setRightPanel(option.id)}
            >
              <MockRightPanelHint mode={option.id} />
            </CompareCard>
          ))}
        </div>
      </section>
    </div>
  );
}

function LockChip({
  label,
  value,
  locked = false,
}: {
  label: string;
  value: string;
  locked?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono",
        locked
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      <span className="opacity-70">{label}</span>
      <span className="text-foreground">{value}</span>
      {locked ? <span className="text-[9px] uppercase tracking-wide opacity-70">ok</span> : null}
    </span>
  );
}

function IsolatedWorkspaceStage({
  feed,
  scroll,
  chrome,
  composer,
  rightPanel,
  compact = false,
}: {
  feed: FeedMode;
  scroll: ScrollMode;
  chrome: ChromeMode;
  composer: ComposerMode;
  rightPanel: RightPanelMode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/70 bg-gradient-to-br from-muted/50 via-background to-muted/30",
        compact ? "p-1.5" : "p-2.5 shadow-sm",
      )}
    >
      {/* Project header strip */}
      {!compact ? (
        <div className="mb-2 flex h-9 items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/90 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-semibold text-foreground">Macro Markets</span>
            <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              GitHub Project
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
            <span>Assistente</span>
            <span>Board</span>
            <span>Workspaces</span>
            <span className="rounded-md bg-foreground px-2 py-1 text-background">+ Nova issue</span>
          </div>
        </div>
      ) : null}

      {/* Tabs */}
      <div
        className={cn(
          "mb-2 flex items-end gap-1 border-b border-border/50",
          compact ? "px-0.5" : "px-1",
        )}
      >
        {(compact
          ? ["Workspaces", "MAC-7 · Implementar…"]
          : ["Workspaces", "Sessão do projeto", "Shared order book…", "MAC-7 · Implementar fluxo P…"]
        ).map((tab, index, all) => {
          const active = index === all.length - 1;
          return (
            <span
              key={tab}
              className={cn(
                "truncate rounded-t-md px-2 py-1.5 text-[10px]",
                active
                  ? "border border-b-0 border-border/60 bg-background font-medium text-foreground"
                  : "text-muted-foreground",
                compact && "max-w-[7rem]",
                !compact && index > 0 && "max-w-[9rem]",
              )}
            >
              {tab}
            </span>
          );
        })}
      </div>

      <MockAssistantSession
        feed={feed}
        scroll={scroll}
        chrome={chrome}
        composer={composer}
        rightPanel={compact ? "closed" : rightPanel}
        compact={compact}
        tall={!compact}
      />
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
      <div className="grid gap-2">
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
      <div className="bg-muted/20 p-2">{children}</div>
    </button>
  );
}

function MockAssistantSession({
  feed,
  scroll,
  chrome,
  composer,
  rightPanel,
  compact = false,
  tall = false,
}: {
  feed: FeedMode;
  scroll: ScrollMode;
  chrome: ChromeMode;
  composer: ComposerMode;
  rightPanel: RightPanelMode;
  compact?: boolean;
  tall?: boolean;
}) {
  const nested = scroll === "nested-current";
  const wide = scroll === "single-feed-wide";
  const showRight = rightPanel !== "closed" && !compact;
  const floatingRight = rightPanel === "floating-dock";

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden bg-background",
        compact ? "h-[220px]" : tall ? "h-[560px]" : "h-[520px]",
        chrome === "card-shadow" && "rounded-xl border border-border/60 shadow-sm",
        chrome === "flat-border" && "rounded-lg border border-border/50",
        chrome === "borderless" && "rounded-md",
      )}
    >
      {!compact ? (
        <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-2.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            MAC-7
          </span>
          <div className="flex items-center gap-1 text-muted-foreground">
            <GitCompare className="h-3.5 w-3.5" />
            <Terminal className="h-3.5 w-3.5" />
            <span className="text-[10px] tabular-nums">+12 −3</span>
          </div>
        </div>
      ) : null}

      <div className={cn("relative flex min-h-0 flex-1", nested && "gap-0")}>
        <div
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col",
            nested && "overflow-hidden",
          )}
        >
          {/* Nested scroll simulation: outer card scroll + inner feed scroll */}
          <div
            className={cn(
              "min-h-0 flex-1",
              nested ? "overflow-y-auto border-b border-dashed border-amber-500/40" : "overflow-hidden",
            )}
          >
            {nested && !compact ? (
              <div className="bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                scroll externo (card)
              </div>
            ) : null}
            <div
              className={cn(
                "h-full",
                nested || !nested ? "overflow-y-auto" : null,
                nested && "max-h-[55%] border border-dashed border-sky-500/40",
              )}
            >
              {nested && !compact ? (
                <div className="bg-sky-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-400">
                  scroll interno (feed)
                </div>
              ) : null}
              <div
                className={cn(
                  "space-y-2.5 px-3 py-3",
                  !wide && !compact && "mx-auto max-w-xl",
                  compact && "px-2 py-2",
                )}
              >
                <MockFeed feed={feed} compact={compact} />
              </div>
            </div>
            {nested && !compact ? (
              <div className="space-y-1 px-3 py-2 text-[10px] text-muted-foreground">
                <p>… conteúdo extra do card que força 2ª barra …</p>
                <p>toolbar residual · meta · padding</p>
              </div>
            ) : null}
          </div>

          <div className={cn("shrink-0", composer === "floating-pill" && "px-2 pb-2 pt-1")}>
            <MockComposer mode={composer} compact={compact} />
          </div>
        </div>

        {showRight && rightPanel === "fixed-column" ? (
          <MockEnvironmentPanel className="w-[160px] shrink-0 border-l border-border/60" />
        ) : null}
      </div>

      {showRight && floatingRight ? (
        <div className="pointer-events-none absolute bottom-16 right-3 top-12 w-[148px]">
          <MockEnvironmentPanel className="pointer-events-auto h-full rounded-xl border border-border/70 bg-background/95 shadow-md backdrop-blur-sm" />
        </div>
      ) : null}
    </div>
  );
}

function MockFeed({ feed, compact }: { feed: FeedMode; compact?: boolean }) {
  if (feed === "timeline-current") {
    return (
      <>
        <ToolRow
          label="RODOU"
          cmd={`bin/bash -c "sed -n '1,220p' lib/order_book…"`}
          loud
        />
        <ToolRow label="RODOU" cmd={`bin/bash -c "rg -n 'depth' apps/…"`} loud />
        {!compact ? (
          <ToolRow label="RODOU" cmd={`bin/bash -c "mix test apps/order_book"`} loud />
        ) : null}
        <GoalBanner compact={compact} />
        <ToolRow label="RODOU" cmd={`bin/bash -c "git status --short"`} loud />
      </>
    );
  }

  if (feed === "codex-chat") {
    return (
      <>
        <UserBubble>Vamos tocar o build agora dessa task MAC-7</UserBubble>
        <p className="text-[11px] leading-relaxed text-foreground/90">
          Beleza — vou inspecionar o working tree e rodar o build focado em{" "}
          <span className="rounded bg-muted px-1 font-mono text-[10px]">order_book</span>.
        </p>
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          Worked for 1m 43s
          <ChevronDown className="h-3 w-3" />
        </p>
        <p className="text-[11px] leading-relaxed text-foreground/90">
          Preview local:{" "}
          <span className="text-sky-700 underline dark:text-sky-400">http://127.0.0.1:4000</span>
        </p>
        {!compact ? (
          <p className="text-[11px] text-muted-foreground">
            Próximo: validar depth feed e abrir PR.
          </p>
        ) : null}
      </>
    );
  }

  // hybrid
  return (
    <>
      <UserBubble>Vamos tocar o build agora dessa task MAC-7</UserBubble>
      <p className="text-[11px] leading-relaxed text-foreground/90">
        Ok — inspecionando tree e rodando o build focado.
      </p>
      <ToolRow label="Ran" cmd={`sed -n '1,220p' lib/order_book…`} />
      <ToolRow label="Ran" cmd={`rg -n 'depth' apps/…`} />
      {!compact ? <ToolRow label="Ran" cmd={`mix test apps/order_book`} /> : null}
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
        Worked for 1m 43s
        <ChevronDown className="h-3 w-3" />
      </p>
      <p className="text-[11px] leading-relaxed text-foreground/90">
        Build ok. Pronto para o próximo passo.
      </p>
    </>
  );
}

function ToolRow({
  label,
  cmd,
  loud = false,
}: {
  label: string;
  cmd: string;
  loud?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px]",
        loud
          ? "border border-border/70 bg-muted/50"
          : "border border-transparent bg-muted/30 hover:bg-muted/45",
      )}
    >
      <span
        className={cn(
          "shrink-0 font-semibold uppercase tracking-wide",
          loud ? "text-foreground/80" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-foreground/75">{cmd}</span>
      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/70" />
    </div>
  );
}

function GoalBanner({ compact }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl bg-zinc-900 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-100 dark:bg-zinc-800",
        compact && "py-2 text-[10px]",
      )}
    >
      <span className="font-medium">Objetivo:</span> Vamos tocar o build agora dessa task MAC-7 —
      depth feed + validação.
    </div>
  );
}

function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-violet-500/10 px-3 py-1.5 text-[11px] text-foreground/90">
        {children}
      </div>
    </div>
  );
}

function ComposerShowcase({
  mode,
  selected = false,
  zoom = false,
}: {
  mode: ComposerMode;
  selected?: boolean;
  zoom?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border/60 bg-background",
        zoom ? "min-h-[280px]" : "min-h-[240px]",
        selected && "ring-1 ring-foreground/10",
      )}
    >
      <div className="min-h-0 flex-1 space-y-2 px-3 py-3">
        <UserBubble>Vamos tocar o build agora dessa task MAC-7</UserBubble>
        <p className="text-[11px] leading-relaxed text-foreground/90">
          Beleza — inspecionando tree e rodando o build focado em{" "}
          <span className="rounded bg-muted px-1 font-mono text-[10px]">order_book</span>.
        </p>
        <p className="text-[10px] text-muted-foreground">Worked for 1m 43s</p>
      </div>

      <div
        className={cn(
          "shrink-0 border-t border-dashed border-amber-500/50 bg-amber-500/[0.07] px-3 py-2",
          zoom && "px-4 py-3",
        )}
      >
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
          Composer · {mode}
        </p>
        <MockComposer mode={mode} size={zoom ? "xl" : "lg"} />
        {mode === "floating-pill" ? (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Menu <strong className="font-medium text-foreground">+</strong> esconde Diff / KB /
            Yolo / Skills.
          </p>
        ) : null}
        {mode === "split-minimal" ? (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Toggles avançados atrás de <strong className="font-medium text-foreground">⋯</strong>.
          </p>
        ) : null}
        {mode === "toolbar-dense" ? (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Todos os chips visíveis na barra (estado atual na tela real).
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MockComposer({
  mode,
  compact,
  size = "md",
}: {
  mode: ComposerMode;
  compact?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const resolvedSize = compact ? "sm" : size;
  const isLarge = resolvedSize === "lg" || resolvedSize === "xl";
  const chipSize = resolvedSize === "xl" ? "lg" : resolvedSize === "lg" ? "md" : "sm";

  if (mode === "floating-pill") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-border/70 bg-card shadow-sm",
          resolvedSize === "sm" && "h-9 px-2.5",
          resolvedSize === "md" && "h-11 px-2.5",
          resolvedSize === "lg" && "h-12 px-3",
          resolvedSize === "xl" && "h-14 px-4",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground",
            isLarge ? "h-7 w-7" : "h-6 w-6",
          )}
        >
          <Plus className={isLarge ? "h-4 w-4" : "h-3.5 w-3.5"} />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-muted-foreground",
            resolvedSize === "xl" ? "text-sm" : "text-[11px]",
          )}
        >
          Ask for follow-up changes…
        </span>
        {resolvedSize !== "sm" ? (
          <span
            className={cn(
              "shrink-0 rounded-full border border-border/60 text-muted-foreground",
              resolvedSize === "xl" ? "px-3 py-1 text-[11px]" : "px-2 py-0.5 text-[9px]",
            )}
          >
            Ask for approval
          </span>
        ) : null}
        <span
          className={cn(
            "shrink-0 text-muted-foreground",
            resolvedSize === "xl" ? "text-xs" : "text-[9px]",
          )}
        >
          3.5 · Extra
        </span>
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-foreground text-background",
            resolvedSize === "xl" ? "h-8 w-8 text-sm" : "h-6 w-6 text-[10px]",
          )}
        >
          ↑
        </span>
      </div>
    );
  }

  if (mode === "split-minimal") {
    return (
      <div
        className={cn(
          "rounded-2xl border border-border/70 bg-card shadow-sm",
          resolvedSize === "xl" ? "px-4 py-3" : "px-3 py-2",
        )}
      >
        <p
          className={cn(
            "text-muted-foreground",
            resolvedSize === "xl" ? "min-h-10 text-sm" : "text-[11px]",
          )}
        >
          Escreva uma mensagem…
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Plus className={isLarge ? "h-4 w-4" : "h-3.5 w-3.5"} />
            <span
              className={cn(
                "rounded-md border border-border/60 px-1.5 py-0.5",
                resolvedSize === "xl" ? "text-xs" : "text-[10px]",
              )}
            >
              ⋯
            </span>
            {isLarge ? (
              <span className="text-[10px] text-muted-foreground/80">Diff · KB · Yolo · Skills</span>
            ) : null}
          </div>
          <div
            className={cn(
              "flex items-center gap-2 text-muted-foreground",
              resolvedSize === "xl" ? "text-xs" : "text-[9px]",
            )}
          >
            <span>Codex</span>
            <Mic className={isLarge ? "h-3.5 w-3.5" : "h-3 w-3"} />
            <span
              className={cn(
                "flex items-center justify-center rounded-full bg-foreground text-background",
                resolvedSize === "xl" ? "h-8 w-8 text-sm" : "h-6 w-6 text-[10px]",
              )}
            >
              ↑
            </span>
          </div>
        </div>
      </div>
    );
  }

  // toolbar-dense (current)
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-card shadow-sm",
        resolvedSize === "xl" ? "px-4 py-3" : "px-3 py-2",
      )}
    >
      <p
        className={cn(
          "text-muted-foreground",
          resolvedSize === "xl" ? "min-h-10 text-sm" : "text-[11px]",
        )}
      >
        Escreva uma mensagem…
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ComposerChip icon={<Plus className="h-3 w-3" />} size={chipSize} />
        <ComposerChip label="Diff" size={chipSize} />
        <ComposerChip label="KB" icon={<Sparkles className="h-3 w-3" />} size={chipSize} />
        <ComposerChip label="Yolo" tone="warn" size={chipSize} />
        {resolvedSize !== "sm" ? (
          <>
            <ComposerChip label="Skills: Implementation — Auto" size={chipSize} />
            <ComposerChip label="Rodar de forma autônoma" size={chipSize} />
            <ComposerChip label="Mágico" size={chipSize} />
          </>
        ) : null}
        <span
          className={cn(
            "ml-auto flex items-center gap-1.5 text-muted-foreground",
            resolvedSize === "xl" ? "text-xs" : "text-[9px]",
          )}
        >
          Codex · GPT-3.5 · Extra alto
          <span
            className={cn(
              "flex items-center justify-center rounded-full bg-foreground text-background",
              resolvedSize === "xl" ? "h-8 w-8 text-sm" : "h-6 w-6 text-[10px]",
            )}
          >
            ↑
          </span>
        </span>
      </div>
    </div>
  );
}

function ComposerChip({
  label,
  icon,
  tone,
  size = "sm",
}: {
  label?: string;
  icon?: ReactNode;
  tone?: "warn";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 text-muted-foreground",
        size === "sm" && "px-1.5 py-0.5 text-[9px]",
        size === "md" && "px-2 py-1 text-[10px]",
        size === "lg" && "px-2.5 py-1 text-[11px]",
        tone === "warn" && "border-amber-500/40 text-amber-700 dark:text-amber-400",
      )}
    >
      {icon}
      {label}
    </span>
  );
}

function MockEnvironmentPanel({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 overflow-hidden p-2.5", className)}>
      <div>
        <p className="text-[10px] font-semibold text-foreground">Environment</p>
        <div className="mt-1.5 space-y-1 text-[10px] text-muted-foreground">
          <p className="flex items-center justify-between gap-1">
            <span>Changes</span>
            <span className="tabular-nums text-foreground/80">+12 −3</span>
          </p>
          <p className="flex items-center gap-1">
            <HardDrive className="h-3 w-3" />
            Local
          </p>
          <p className="flex items-center gap-1 font-mono">
            <GitBranch className="h-3 w-3" />
            feat/mac-7
          </p>
          <p className="pt-1 text-foreground/80 underline-offset-2 hover:underline">Commit or push</p>
          <p className="text-foreground/80 underline-offset-2 hover:underline">Compare branch</p>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold text-foreground">Sources</p>
        <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
          <MessageSquare className="h-3 w-3 shrink-0" />
          macro-markets
        </p>
      </div>
    </div>
  );
}

function MockScrollHint({ mode }: { mode: ScrollMode }) {
  return (
    <div className="space-y-1.5 p-1">
      <div
        className={cn(
          "rounded-md border border-dashed p-2 text-[10px]",
          mode === "nested-current"
            ? "border-amber-500/50 bg-amber-500/5 text-amber-800 dark:text-amber-300"
            : "border-emerald-500/40 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300",
        )}
      >
        {mode === "nested-current"
          ? "2+ scrollbars (card + feed)"
          : mode === "single-feed-wide"
            ? "1 scrollbar · feed wide"
            : "1 scrollbar · feed + composer fixo"}
      </div>
      <div className="h-16 overflow-hidden rounded border border-border/50 bg-background">
        <div className="space-y-1 p-1.5">
          <div className="h-2 rounded bg-muted" />
          <div className="h-2 w-4/5 rounded bg-muted" />
          <div className="h-2 w-3/5 rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

function MockChromeHint({ mode }: { mode: ChromeMode }) {
  return (
    <div className="bg-muted/40 p-2">
      <div
        className={cn(
          "bg-background p-3 text-[10px] text-muted-foreground",
          mode === "card-shadow" && "rounded-xl border border-border/60 shadow-sm",
          mode === "flat-border" && "rounded-lg border border-border/50",
          mode === "borderless" && "rounded-md",
        )}
      >
        Feed + composer
      </div>
    </div>
  );
}

function MockRightPanelHint({ mode }: { mode: RightPanelMode }) {
  if (mode === "closed") {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-border/60 text-[10px] text-muted-foreground">
        Só toolbar
      </div>
    );
  }
  return (
    <div
      className={cn(
        "relative flex h-24 overflow-hidden rounded-md border border-border/50 bg-background",
        mode === "floating-dock" && "bg-muted/30",
      )}
    >
      <div className="flex-1 p-2">
        <div className="h-2 w-3/4 rounded bg-muted" />
      </div>
      <div
        className={cn(
          "w-14 border-l border-border/60 bg-card p-1.5 text-[8px] text-muted-foreground",
          mode === "floating-dock" &&
            "absolute bottom-1 right-1 top-1 w-12 rounded-md border shadow-sm",
        )}
      >
        Env
      </div>
    </div>
  );
}
