# Environment workspace dock (Preview/Terminal pattern)

**Date:** 2026-07-14  
**Status:** Approved for planning  
**Domain:** Tracker sessions workspace UI  
**Supersedes (partial):** floating `EnvironmentFloatingDock` placement from
`2026-07-14-assistant-session-shell-design.md` § rightPanel / Environment

## 1. Problem

O painel Ambiente hoje é um overlay flutuante (`EnvironmentFloatingDock`)
dentro de `AssistantSessionShell` / `ProjectAssistantPanel`, com toggle em uma
faixa própria do header da sessão. Isso diverge do padrão já estabelecido para
Preview e Terminal: ícone no toolbar da issue + dock coluna à direita no
`ProjectSessionsWorkspace`.

## 2. Goals

1. Mover Ambiente para o **mesmo nível** de Preview/Terminal (opção A).
2. Ícone no `IssueWorkingTreeToolbar` com estado `aria-pressed` e estilos
   `sessionToolbarIconButton*`.
3. Dock redimensionável irmão do conteúdo em `splitContainerRef`.
4. Remover o floating overlay e o toggle do painel do assistente.
5. Exclusividade mútua com Preview e Terminal.

## 3. Non-goals

- Fullscreen no dock Ambiente (conteúdo estreito; Preview/Terminal mantêm o
  deles).
- Implementar commit/PR real além do destino atual (navegar para a issue em
  `sessions`).
- Dock Ambiente em chats freeform / project assistant sem issue.
- Abstrair um `SessionSideDock` genérico compartilhado (pode vir depois).
- Redesign do conteúdo informacional (Changes, Sources, ações) — só o
  container/chrome muda.

## 4. Decision

**Approach:** Espelhar Preview/Terminal exatamente
(`SessionEnvironmentDockContext` + `IssueEnvironmentDock` + wiring no
workspace), em vez de dock genérico ou reempacotar o floating.

**Default open:** fechado (como Preview/Terminal). O default-open atual do
floating em threads issue-bound é removido.

## 5. Architecture

```
ProjectSessionsWorkspace
├── SessionTerminalDockContext
├── SessionPreviewDockContext
├── SessionEnvironmentDockContext   ← novo
└── splitContainerRef (flex row)
    ├── section (tabs + session content)
    │   └── IssueSessionSplitLayout
    │       └── IssueWorkingTreeToolbar
    │           ├── Terminal toggle
    │           ├── Preview toggle
    │           └── Environment toggle   ← novo
    ├── IssueTerminalDock?             (mutually exclusive)
    ├── IssuePreviewDock?              (mutually exclusive)
    └── IssueEnvironmentDock?          ← novo (mutually exclusive)
```

### State (workspace)

| State | Role |
|-------|------|
| `environmentDockIssue: string \| null` | Issue cujo dock Ambiente está aberto |
| `toggleEnvironment(issueId)` | Abre para a issue ou fecha se já aberta; fecha Preview/Terminal |
| Preview/Terminal toggles | Ao abrir, fecham Ambiente |

Sem `environmentFullscreen` — fora de escopo.

### Components

| Piece | Responsibility |
|-------|----------------|
| `sessionEnvironmentDockContext.ts` | Context + hook (`openIssueIdentifier`, `toggleEnvironment`) |
| `IssueEnvironmentDock.tsx` | Aside: resize (`useHorizontalPanelResize`), handle esquerdo, chrome border/rounded como Preview; título + X; conteúdo Ambiente |
| Conteúdo Ambiente | Extrair miolo de `EnvironmentFloatingDock` (changes, local, branch, Commit/Push, Comparar, Fontes) para reuso no dock |
| `IssueWorkingTreeToolbar` | Props `environmentOpen` / `onEnvironmentToggle` + botão ícone |
| `IssueSessionSplitLayout` | Lê context e passa props ao toolbar |
| `ProjectSessionsWorkspace` | Estado, exclusividade, render do dock |

### Compare / Commit-push

- **Comparar:** `IssueEnvironmentDock` embute o próprio `GitDiffLauncher`
  (mesmo modal; `openRequestId` local no botão Comparar). Sem callback para o
  assistente e sem segundo modal. `onSendReview` pode ficar omitido no dock
  (review via composer do assistente permanece).
- **Commit e push:** manter comportamento atual — navegar para
  `issuePath(..., "sessions")` até existir trigger real de commit/PR.

### Diff stats

`useWorkspaceDiffStats` (ou equivalente) passa a alimentar o dock no nível do
workspace / `IssueEnvironmentDock`, não o floating dentro de
`ProjectAssistantPanel`.

## 6. Cleanup

- Remover `environmentOpen` / toggle / `EnvironmentFloatingDock` de
  `ProjectAssistantPanel`.
- Remover slot `environment` de `AssistantSessionShell` (ou deixar de usá-lo e
  limpar a prop).
- Remover/atualizar testes do floating; adicionar testes do dock workspace.
- Atualizar a sandbox/proposals se ainda documentarem `floating-dock` como
  decisão vigente para Ambiente (nota de supersessão neste spec é suficiente
  se a sandbox for só histórico).

## 7. Testing

- Context/toolbar: toggle abre/fecha; `aria-pressed` reflete estado.
- Dock: render do conteúdo, close via X, resize storage key dedicada.
- Exclusividade: abrir Ambiente fecha Preview/Terminal e vice-versa.
- `ProjectAssistantPanel`: não mostra mais floating/toggle Ambiente.
- WSL: um arquivo/filtro de teste por comando (sem suites amplas).

## 8. File map (expected)

**Create**

- `tracker/src/components/sessions/sessionEnvironmentDockContext.ts`
- `tracker/src/components/sessions/IssueEnvironmentDock.tsx`
- `tracker/src/components/sessions/__tests__/IssueEnvironmentDock.test.tsx`
  (e/ou cobertura via `IssueSessionSplitLayout` / workspace tests)

**Modify**

- `tracker/src/components/sessions/ProjectSessionsWorkspace.tsx`
- `tracker/src/components/sessions/IssueWorkingTreeToolbar.tsx`
- `tracker/src/components/sessions/IssueSessionSplitLayout.tsx`
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- `tracker/src/components/assistant/AssistantSessionShell.tsx`
- Related tests under `tracker/src/components/sessions/__tests__/` and
  `tracker/src/components/assistant/__tests__/`

**Delete or gut**

- `tracker/src/components/assistant/EnvironmentFloatingDock.tsx` (após extrair
  conteúdo) e seu teste dedicado, se o dock novo cobrir o comportamento.
