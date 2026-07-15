# Sidebar Sessions Performance & Flat Tree — Design

> Substitui a hierarquia **Projeto → Workspace → Sessão** na navegação lateral
> por **Projeto → Sessão** (estilo Cursor), e redesenha o carregamento para
> eliminar a sobrecarga que trava a UI em projetos grandes (ex.: Advising).

**Status:** draft for review  
**Related:** supersede a hierarquia de
[`2026-07-13-symphony-sidebar-redesign-design.md`](./2026-07-13-symphony-sidebar-redesign-design.md)
§4–5 para a árvore de navegação; ações contextuais e shell utilitário daquele
spec permanecem válidos salvo conflito explícito abaixo.

## 1. Problema (evidência)

Ao abrir `/tracker/projects/advising/workspaces/...` ou expandir Advising:

| Sintoma | Causa medida |
|--------|----------------|
| Spinner eterno no projeto | `EventSource` → `GET .../worktrees/events` com `Accept: text/event-stream` → **406** (`WorktreeInventoryController` só declara `formats: [:json]`); EventSource reconecta em loop |
| Crash se o stream inicia | `WorktreeInventoryEventStream` chama `chunk/2` via **Agent** (outro processo) → Bandit: *Adapter functions must be called by stream owner* |
| Payload pesado | `GET .../issues` em Advising: **790 issues / ~1.08 MB** (44% `description`), **sem limite**, chamado **2×** (sidebar + `useProjectSessions`) |
| Polling repetido | `useAgentExecutions` faz `GET /agent_executions` a cada **5s**; na URL de workspaces monta **várias vezes** (sidebar + `WorkspaceContext` + `useProjectSessions`) → curls duplicados no DevTools |
| Recents repetidos | `useRecents` poll **8s** + `listRecents(100)` de novo no expand da sidebar e na página de sessions |
| Limits inúteis | `SIDEBAR_DEFAULT_*_LIMIT` só corta a árvore **depois** de baixar inventory + issues + recents |
| Inventory no caminho crítico | Expandir projeto dispara scan `du`+`git` por árvore; sidebar não precisa disso para listar sessões |

Advising tem poucos workspaces em disco (~2); o travamento **não** é “muitos
diretórios”, e sim API/stream errados + payload ilimitado + polling.

## 2. Objetivos

1. Árvore lateral: **Projeto → Sessão** (sem nível Workspace na nav).
2. Ordenar projetos e sessões por atividade mais recente primeiro (pins e
   status ativo ainda podem ter precedência).
3. **Paginar / limitar** sessões por projeto no servidor (não só na UI).
4. Remover inventory disk/git do caminho crítico da sidebar e da lista de
   sessões da página.
5. Substituir polling de agent executions por **push (PubSub + channel)** com
   **um único** provider no layout (zero polls paralelos / curls duplicados).
6. Substituir polling / refetch de **recents** por **push (PubSub + channel)**
   com um único `RecentsProvider`; sidebar/página não chamam `GET /recents` no
   expand.
7. Consertar (ou aposentar) o SSE de inventory se ainda for usado na página de
   limpeza de workspaces.
8. Manter a página rápida com projetos grandes (centenas/milhares de issues).

## 3. Não objetivos

- Migrar diretórios físicos / unificar modelo de persistência workspace↔session
  no filesystem.
- Redesenhar board, KB, settings, ou o dock de environment.
- Sync multi-dispositivo de preferências da sidebar.
- Resolver o N+1 do sync GitHub/Jira neste spec (nota: compete por SQLite; fora
  do escopo imediato, mas o redesign não deve piorar).
- Carregar description completa de issues na sidebar.

## 4. Decisão de hierarquia

### Antes (spec 2026-07-13)

```text
Projeto
└── Workspace
    └── Sessão
```

### Agora (aprovado pelo produto)

```text
Projeto                    ← ordenado por atividade do projeto
├── Sessão mais recente
├── ...
└── Mais… / próxima página ← limite servidor + UI
```

**Normalização workspace–sessão na nav:** o nó de sessão carrega o vínculo de
workspace só como metadado (`workspacePath` / `workspaceId` opcional) para
ações (abrir editor, limpar árvore, new-session no mesmo cwd). A UI **não**
mostra um nível expandível de workspace.

Workspaces continuam existindo como conceito de runtime/disk na página de
cleanup / inventory — fora da árvore principal.

## 5. Abordagens consideradas

### A — Patch mínimo (só corrigir 406 + Bandit + timeout)

Prós: rápido. Contras: sidebar ainda puxa issues ilimitadas + inventory;
polling 5s permanece; hierarquia Workspace permanece.

### B — API leve paginada + flat tree + PubSub executions (recomendada)

Prós: ataca causa raiz de carga; alinha com Cursor; reutiliza
`Phoenix.PubSub` + `TrackerChannel` / tópico global. Contras: muda contrato da
sidebar e da página de sessions.

### C — SSE HTTP único “sidebar bootstrap” com tudo misturado

Prós: um pipe. Contras: reimplementa o que channels já fazem; inventário/SSE
já falhou por Accept/process ownership; mais superfície de bug.

**Escolha: B.**

## 6. Arquitetura

```text
┌──────────── Tracker SPA ────────────┐
│ SidebarTreeProvider                 │
│  • list projects (leve)             │
│  • on expand: GET project sessions  │
│    ?limit=&cursor= (leve)           │
│  • AgentExecutionsProvider (1x)     │
│    ← socket "agent_executions"      │
│  • RecentsProvider (1x)             │
│    ← socket "recents"               │
└───────────────┬─────────────────────┘
                │
┌───────────────▼─────────────────────┐
│ Elixir                              │
│  SessionsIndex (DB/threads)         │
│  AgentExecution.Broadcaster         │
│    ← Orchestrator / StatusDashboard │
│  Recents.Broadcaster (debounced)    │
│    ← thread/issue activity          │
│  PubSub → Channel push              │
│  Inventory scan: cleanup page only  │
└─────────────────────────────────────┘
```

### 6.1 API: sessões por projeto (nova)

`GET /api/tracker/v1/projects/:slug/sessions`

Query:

| Param | Default | Max | Notas |
|-------|---------|-----|--------|
| `limit` | `20` | `50` | por página |
| `cursor` | — | — | opaque (activity timestamp + id) |
| `include_archived` | `false` | | |

Resposta (leve — **sem** `description` de issue, **sem** inventory):

```json
{
  "data": [
    {
      "id": "thread:123|issue:ADV-1|workspace:...",
      "title": "Fix login",
      "kind": "execution|authoring|chat|workspace_session",
      "href": "/tracker/projects/advising/...",
      "updated_at": "2026-07-14T...",
      "aggregate_status": "live|idle|error|none|...",
      "agent_kind": "codex|claude|null",
      "issue_identifier": "ADV-1",
      "workspace_path": "/.../optional",
      "workspace_id": "8006",
      "pinned": false,
      "archived": false
    }
  ],
  "meta": {
    "next_cursor": "...|null",
    "project_activity_at": "..."
  }
}
```

Fontes server-side (união ordenada por `updated_at`):

- assistant threads do projeto (scopes relevantes),
- execuções / issues com atividade recente **só campos indexáveis**
  (identifier, title, updated_at, status),
- recents já existentes, filtrados por `project_slug`.

**Proibido nesta API:** `Context.list_issues/2` completo com preload +
description; `Inventory.scan` / `scan_stream`.

Paginação cursor-based: estável o bastante para sidebar; “Mais…” pede a
próxima página e **anexa** (não substitui).

### 6.2 API: lista de projetos (ajuste)

`GET /projects` (ou campo derivado) deve expor `last_activity_at` (max das
sessões/issues recentes) para ordenar a árvore **sem** expandir todos os
projetos. Se o custo for alto, calcular a partir de um índice/resumo já
mantido; não escanear disco.

### 6.3 Agent executions: PubSub em vez de poll

**Hoje:** `useAgentExecutions` → `GET /agent_executions` a cada 5s no layout
(e consumidores extras).

**Novo:**

1. Backend: ao projetar mudança relevante no snapshot do Orchestrator (live /
   idle / waiting / error / paused / removido), publicar:

   ```elixir
   Phoenix.PubSub.broadcast(
     SymphonyElixir.PubSub,
     "agent_executions",
     {:agent_execution_event, "upsert" | "remove" | "snapshot", payload}
   )
   ```

2. Channel novo (preferido) `agent_executions` no `UserSocket`, **ou** tópico
   dedicado espelhando o padrão de `observability:global`.

3. No `join`: enviar **snapshot inicial** (mesmo payload de
   `AgentExecutionController.index`) uma vez.

4. Depois: pushes incrementais `upsert` / `remove` (payload =
   `TrackerPresenter.agent_execution/1`).

5. Frontend: **um** `AgentExecutionsProvider` no layout; hooks filhos
   (`useSidebarTree`, `WorkspaceContext`, `useProjectSessions`, observability,
   launcher) **só leem contexto**. Remover `useFocusedInterval` de 5s. HTTP
   `GET /agent_executions` apenas no fallback de join/reconnect (**uma vez**),
   nunca N pollers paralelos (o curl repetido visto no Chrome DevTools).

6. Debounce/coalesce no backend: no máximo ~2–5 Hz de broadcasts se o
   orchestrator emitir rajadas (evitar flood de eventos finos).

**Por que channel/PubSub e não SSE HTTP:** já existe `UserSocket` +
`TrackerChannel` + PubSub; evita o bug de `formats: [:json]` + Accept
event-stream; ownership do processo é o do socket Phoenix.

### 6.3b Recents: PubSub em vez de poll / expand refetch

**Hoje:** `useRecents` → `GET /recents` a cada **8s** (com focus); além disso
`useSidebarTree` e `useProjectSessions` chamam `listRecents(100)` no load.

**Novo:**

1. `Recents.Broadcaster` debounced publica snapshot em tópico `"recents"` quando
   threads/atividade relevante mudam (e opcionalmente após flush de executions).
2. Channel `recents` no `UserSocket`: snapshot no join + pushes.
3. **Um** `RecentsProvider` no layout; `useRecents` só lê contexto (sem
   `setInterval`).
4. Expand de projeto **não** chama `GET /recents`; usa sessions API.
5. Página de sessions filtra recents do provider por `projectSlug` se ainda
   precisar de “related”.

### 6.4 Inventory: fora da sidebar

| Superfície | Comportamento |
|------------|----------------|
| Sidebar expand | **Não** chama `/worktrees` nem `/worktrees/events` |
| Página Sessions (lista) | Usa a mesma API paginada de sessões; **não** monta inventory stream |
| Página / fluxo de cleanup de worktrees | Continua podendo usar inventory |

**Se inventory stream permanecer:**

1. Aceitar `text/event-stream` no controller (`formats` adequados **ou**
   bypass de content negotiation na action `events`).
2. Chunk **somente** no processo dono da conn (sem Agent intermediário);
   usar mailbox / callback no mesmo processo, ou `Stream` sincronamente no
   request process.
3. Client: em `onerror`, **fechar** EventSource e marcar
   `fallbackStarted` (sidebar e `useProjectSessions`) para não reconectar +
   re-scan em loop.

### 6.5 Issues completas

Board / issue drawer continuam com `GET .../issues` conforme necessário.

Sidebar e sessions list **não** usam essa rota. Se algum título faltar,
a API de sessions já inclui `title` curto.

Opcional futuro (fora do MVP): `GET .../issues?fields=summary&limit=` para o
board; não bloqueia este spec.

### 6.6 Frontend: árvore

- `SidebarProjectNode.sessions` + `overflow` / `nextCursor` (sem
  `workspaces[]` na nav, ou workspaces vazios deprecated).
- Expand projeto → `startBranchLoad` só chama sessions API (+ opcionalmente
  threads já embutidos nela).
- Ordenação projetos: `project_activity_at` desc; pins first.
- Ordenação sessões: pins → status ativo/erro → `updated_at` desc.
- Limite default UI alinhado ao `limit` do servidor (ex. 20); “Mais…” usa
  `next_cursor`.
- Compartilhar cache de branch entre sidebar e `ProjectSessionsPage` (mesmo
  provider / query key) para não dobrar fetch na URL de workspaces.

### 6.7 Rotas e href

Sessões ainda navegam para rotas existentes (`/issues/...`,
`/workspaces/:id`, assistant threads). O flatten é **só apresentação** na
árvore; não exige mudar o router.

## 7. Contratos e limites

| Recurso | Limite |
|---------|--------|
| Sessions page size | default 20, max 50 |
| Sessions expand iniciais | 1 página |
| Agent execution HTTP | só snapshot no join / reconnect (≤1); **0** polls |
| Recents HTTP | só snapshot no join / reconnect (≤1); **0** polls / expand fetches |
| Inventory na sidebar | 0 requests |
| Issues full na sidebar | 0 requests |

## 8. Erros e resiliência

- Sessions API falha → ramo `error` / retry; não dispara inventory fallback.
- Channel disconnect → snapshot HTTP único + resubscribe; sem poll 5s.
- Cursor inválido → 400 + cliente reinicia da primeira página.
- Projeto sem sessões → ramo vazio, sem spinner infinito.

## 9. Testes

**Backend**

- Sessions index: ordenação, limit, cursor, ausência de description/inventory.
- Agent execution broadcaster: join snapshot + upsert/remove; debounce.
- Recents broadcaster/channel: join snapshot; debounce; notify on thread change.
- Inventory events: Accept `text/event-stream` → 200; sem crash Bandit; client
  abort para o stream.

**Frontend**

- Expand Advising-like (muitos issues no DB): só 1 request sessions limitado.
- `AgentExecutionsProvider`: um subscribe; sem interval 5s; N consumers → 0 HTTP extra.
- `RecentsProvider`: um subscribe; sem interval 8s; expand não chama `/recents`.
- Flat tree: sem `WorkspaceTreeItem` na nav; “Mais…” pagina.
- Workspaces URL: sidebar + page compartilham cache (um fetch).

**Manual**

- Abrir Advising: spinner some em &lt; ~1s; DevTools sem `/worktrees/events`
  406 em loop; sem `/issues` 1MB na sidebar; sem rajada de
  `GET /agent_executions` nem `GET /recents` em idle.

## 10. Migração / rollout

1. Ship sessions API + flat tree + executions channel (feature flag opcional
   `sidebar_sessions_v2`).
2. Desligar inventory no `useSidebarTree` / `useProjectSessions` list path.
3. Fix inventory SSE para cleanup.
4. Remover poll 5s após channel estável.
5. Atualizar
   `2026-07-13-symphony-sidebar-redesign-design.md` com nota de supersessão
   da hierarquia (link para este doc).

## 11. Riscos

| Risco | Mitigação |
|-------|-----------|
| Union sessions incompleta (falta algum tipo) | Checklist de kinds + teste com fixtures de thread/issue/workspace session |
| Broadcast storm do orchestrator | Coalesce/debounce |
| Channel auth | Mesmo token do `UserSocket` / TrackerAuth |
| Páginas que ainda esperam `workspaces[]` na tree | Adaptadores temporários ou feature flag |

## 12. Resumo da decisão

- **Nav:** Projeto → Sessão (Cursor), ordenado por recência, paginado no
  servidor.
- **Dados:** API leve de sessions; zero inventory e zero issues full na
  sidebar.
- **Realtime:** PubSub + Phoenix Channel para agent executions **e** recents;
  um provider cada; sem poll 5s/8s e sem curls duplicados.
- **Inventory SSE:** só cleanup; corrigir Accept + process ownership; client
  sem reconnect storm.
