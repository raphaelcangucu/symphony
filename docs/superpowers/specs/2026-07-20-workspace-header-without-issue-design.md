# Workspace header bar without issue

**Date:** 2026-07-20
**Status:** Approved for planning
**Domain:** Tracker sessions / workspaces UI
**Related:** `2026-07-14-environment-workspace-dock-design.md`,
`2026-07-14-assistant-session-shell-design.md`,
`2026-07-09-issue-kb-changed-docs-modal-design.md`

## 1. Problem

Em `/projects/:slug/workspaces/:threadId`, quando o thread **não** está ligado a
uma issue, `AssistantSessionTabContent` não monta `IssueSessionSplitLayout` /
`IssueWorkingTreeToolbar`. O chat renderiza com `hideHeader` e o usuário perde
Diff, Preview, Terminal, Ambiente, Tasks, Code e KB — ações que dependem do
**working tree do workspace**, não da issue.

Exemplo: `http://localhost:4000/tracker/projects/macro-markets/workspaces/8076`
(workspace freeform / orphan com path, sem `issueIdentifier`).

## 2. Goals

1. Todo workspace com thread (com ou sem issue) mostra a **mesma barra** de
   working-tree actions.
2. Controles funcionam de verdade via working tree / `threadId` (não botões
   mortos nem issue-id sintético).
3. Incluir **Diff** (API por thread já existe).
4. Manter paridade visual e comportamento com sessions issue-bound.
5. Generalizar a chave de dock de `issueIdentifier` para um `WorkspaceScope`
   unificado.

## 3. Non-goals

- Inventar `issue_identifier` sintético (`thread:8076`) para reutilizar rotas de
  issue no DB.
- Redesign visual do toolbar (ícones, ordem, estilos `sessionToolbar*`
  permanecem).
- Dock Ambiente em fullscreen.
- Novo produto de “attach issue to workspace” nesta entrega.
- Mudar o `ProjectHeader` global (Board / Workspaces / Terminal / KB do
  projeto).

## 4. Decision

**Approach:** Workspace scope unificado.

```ts
type WorkspaceScope =
  | {
      kind: "issue";
      projectSlug: string;
      issueIdentifier: string;
      threadId?: number;
    }
  | {
      kind: "thread";
      projectSlug: string;
      threadId: number;
      workspacePath: string | null;
    };
```

- Preferir `kind: "issue"` quando `thread.issueIdentifier` estiver presente
  (zero regressão).
- Caso contrário, `kind: "thread"` com `workspace_path` do thread.
- Backend espelha operações issue→path usando o path do thread; sem fingir
  issue no tracker.

## 5. UX

### Controles

| Controle | Sem issue (`kind: "thread"`) | Com issue (`kind: "issue"`) |
|----------|------------------------------|-----------------------------|
| Diff + counters | por `threadId` | igual (já suportado) |
| Preview | dock no working tree do thread | igual |
| Terminal | dock com cwd = `workspace_path` | igual |
| Ambiente | repos / branch / diff do tree; sem PR/commits de issue | igual + PR/commits da issue |
| Tasks | tasks do assistant do thread | igual |
| Code | editor no `workspace_path` do thread | igual |
| KB | modal KB do projeto (controle compartilhado com o composer) | igual + docs da issue quando aplicável |
| Abrir issue | **oculto** | link para a issue (como hoje) |

### Header start (esquerda)

- Com issue: chip `issueIdentifier` + `ExecutionStatusHeaderControl` (atual).
- Sem issue: chip com display name ou basename do workspace (ex. `flaky-pipe`);
  sem inventar issue id. Status de execução quando aplicável.

### Estados de borda

- Sem `workspace_path` provisionado: Code / Terminal / Preview / Ambiente
  desabilitados com tooltip “workspace not provisioned”. Diff / KB / Tasks
  permanecem quando fizer sentido.
- Thread 404 / projeto errado: fallback atual (não montar ações quebradas).
- Mutual exclusivity dos docks laterais: inalterada (só um aberto).

## 6. Architecture

```
ProjectSessionsWorkspace
├── Session*DockContext (openScope / toggle(scope))
└── splitContainerRef
    ├── section
    │   └── WorkspaceSessionSplitLayout   (ex-IssueSessionSplitLayout)
    │       └── WorkspaceWorkingTreeToolbar
    │           ├── Diff (+ counters)
    │           ├── Open issue? (issue only)
    │           ├── Terminal / Preview / Ambiente / Tasks
    │           ├── Code
    │           └── KB
    └── *Dock? keyed by WorkspaceScope
```

### Frontend (tracker)

| Piece | Change |
|-------|--------|
| `AssistantSessionTabContent` | Sempre monta o split layout; escolhe `WorkspaceScope` |
| `IssueSessionSplitLayout` → `WorkspaceSessionSplitLayout` | Aceita scope; header + toolbar |
| `IssueWorkingTreeToolbar` → `WorkspaceWorkingTreeToolbar` | Ações por scope; esconde “open issue” no thread |
| `Session*DockContext` | `openScope` / `toggle(scope)` em vez de só `openIssueIdentifier` |
| Docks Preview / Terminal / Environment / Tasks | Resolvem dados via issue **ou** thread |
| Code (`IssueEditorMenu` / `useIssueEditor`) | Target por thread quando `kind: "thread"` |
| KB | Sem issue: modal projeto / controle do composer; sem `ensureIssueKbPage` |

Renomes podem ser incrementais (aliases) se o diff ficar grande; o contrato
público dos contexts deve migrar para `WorkspaceScope`.

### Backend (Elixir)

Espelhar rotas issue onde ainda faltam equivalentes por thread. Resolução:
`thread.id` → `thread.workspace_path` → mesmas ops de disco/processo.

Rotas novas (nomes ilustrativos; alinhar ao router existente):

| Área | Issue (hoje) | Thread (novo) |
|------|--------------|---------------|
| Diff | — | já: `/assistant/threads/:id/diff*` |
| Editor | `/projects/:slug/issues/:id/editor` | `GET /assistant/threads/:id/editor` |
| Dev servers | `/projects/:slug/issues/:id/dev_servers*` | `/assistant/threads/:id/dev_servers*` (+ events) |
| Terminal shell | issue-scoped tabs/cwd | shell amarrado ao `workspace_path` do thread |

Não persistir `issue_identifier` sintético. Dev servers thread-scoped usam
chave `(project_id, workspace_path, slug)` (ou coluna `thread_id` + unique
equivalente) para isolar pelo working tree real. O plano de implementação
detalha migration vs tabela espelho; o requisito de produto é isolamento por
path do workspace, não por issue inventada.

### Data flow

1. Abrir `/workspaces/:threadId` → metadata (`workspacePath`, `issueIdentifier?`).
2. Montar header com `WorkspaceScope`.
3. Toggle dock → `ProjectSessionsWorkspace` guarda `openScope`.
4. Dock/serviço resolve path via issue path **ou** `thread.workspace_path`.
5. Diff/Code/KB usam o mesmo scope.

## 7. Error handling

| Caso | Comportamento |
|------|----------------|
| Workspace não provisionado | Ações path-dependent disabled + tooltip |
| API thread 404 | Não abrir dock; toast/erro existente do tracker |
| Dev server / editor starting | Poll / reason `starting` como no fluxo issue |
| Ambiente sem issue | Omitir seções PR / commits ligados a issue; mostrar tree/diff/branch |

## 8. Testing

- **Frontend:** `AssistantSessionTabContent` — header + Diff/Terminal/Preview/
  Ambiente/Tasks/Code/KB sem `issueIdentifier`; regressão com issue (open
  issue link, toggles).
- **Contexts/docks:** toggle e mutual exclusivity por `WorkspaceScope`.
- **Backend:** editor / dev_servers / terminal por thread (path correto; 404
  sem workspace).
- **WSL:** um arquivo ou filtro de teste por vez; sem suites largas.

## 9. Out of scope follow-ups

- Attach / link issue a um workspace freeform.
- Generic `SessionSideDock` shared component (ainda opcional).
- Migrar 100% do naming `Issue*` → `Workspace*` em todo o repo numa tacada
  (pode ser incremental após o comportamento).
