# Workspaces "threads-only" — unificação visual da lista de sessões

**Date:** 2026-07-17
**Status:** Approved (implementation)
**Surfaces:** Tracker Workspaces (`workspaceCards.ts`, `WorkspaceDetailPane`,
`WorkspaceListRow`, `WorkspaceRowMenu`)
**Related:** [`2026-07-17-per-session-identity-logs-design.md`](./2026-07-17-per-session-identity-logs-design.md)
(sessão como unidade de identidade — `thread:<id>`)

## 1. Problema

Depois da unificação de sessões em Threads (`issue_execution`, `issue_session`,
`issue`), a página Workspaces ainda projeta `AgentExecution` como linha sintética
"Autônomo · N turnos" (sem lixeira) e a authoring como linha sintética própria,
enquanto as threads reais aparecem abaixo com arquivar. A mesma sessão aparece
duplicada (ex.: "Autônomo" + "GAM-20") e a autônoma não pode ser
arquivada/excluída.

## 2. Decisão

**Threads são a fonte de verdade da lista.** `card.execution` permanece apenas
como enriquecimento: dot de status do header, seção active/waiting e Resume no
menu ⋯. Authoring interativo também é thread — sem linha sintética.

## 3. Comportamento

1. Lista expandida do workspace mostra **somente** `card.sessions` (threads).
   Linhas sintéticas de `card.execution` e `card.authoring` não são renderizadas.
2. `splitRelatedSessions` envia escopos `issue`, `issue_session` e
   `issue_execution` para `sessions`. Dedup por `threadId` /
   `executionSessionId`: quando a execução já tem thread correspondente nos
   recents, existe uma única linha.
3. Execução com `executionSessionId` sem linha correspondente nos recents →
   sintetiza-se **uma** linha de sessão a partir da execução (mesma thread,
   arquivável quando inativa). Execução **sem** `executionSessionId` → nenhuma
   linha inventada; o workspace pode existir só com inventory + ações do menu.
4. Header (`activityLabel`): título da thread mais recente do card — nunca
   "Autônomo · N turnos". O dot de status continua enriquecido por
   `card.execution` quando existir.
5. Arquivar: lixeira em cada thread → `archiveAssistantThread` (mesmo fluxo dos
   chats). Regra da sidebar respeitada: sem archive para execução ativa
   (`running`/`active`/`waiting`/`retrying`). Sem hard delete.
6. Resume: apenas no menu ⋯ do workspace quando `canResumeExecution`.
7. Empty state ("No sessions" + criar) permanece quando `sessions.length === 0`.

## 4. Fora de escopo

- Refatorar sidebar/board além do necessário.
- Remover `card.execution` do modelo de dados.
- Hard delete de execução.

## 5. Testes (WSL: um arquivo/filtro por vez, sequencial)

- `workspaceCards.test.ts`: `issue`/`issue_execution` entram em `sessions`;
  dedup contra `executionSessionId`; síntese apenas com `executionSessionId`;
  regra de archive para execução ativa.
- `ProjectSessionsPanel.test.tsx`: sem linha "Autônomo" duplicada; abrir thread
  da execução abre `/workspaces/<id>`; archive na thread; Resume via menu ⋯.
