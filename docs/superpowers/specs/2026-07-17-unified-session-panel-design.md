# Painel único de sessão — execução do orchestrador dentro do ProjectAssistantPanel

**Date:** 2026-07-17
**Status:** Approved (implementation in progress)
**Surfaces:** `ProjectAssistantPanel`, `AssistantSessionTabContent`,
`IssueSessionSplitLayout`, `ExecutionChatPanel` (a remover), canal
`session_log`, `AgentRunner`/`IssueDispatch`
**Related:**
[`2026-07-17-per-session-identity-logs-design.md`](./2026-07-17-per-session-identity-logs-design.md),
[`2026-07-17-workspaces-threads-only-design.md`](./2026-07-17-workspaces-threads-only-design.md)

## 1. Problema

Há dois chats paralelos: o assistant interativo (`assistant:thread:<id>`,
mensagens de `History`, `AssistantMessageList`) e o de execução do orchestrador
(`session_log:<sessionId>`, `SessionLogTranscript` + `ExecutionControlComposer`).
Abrir `/workspaces/<session-id>` de uma thread `issue_execution` cai no painel
interativo errado; os dispatchers de cards são duplicados; a troca de agente é
gravada em settings da issue, não na sessão.

## 2. Decisões

| Tópico | Decisão |
|---|---|
| Corpo do chat | **Um único corpo** (`AssistantMessageList` + bubbles + tool cards). Entries do `session_log` viram itens desse corpo via adapter (`sessionLogFeed`), sem feed paralelo |
| Detecção de modo | `thread.scope === "issue_execution"` (via metadata da thread) troca a **fonte** do corpo e a semântica do composer |
| Steer durante o run | Prompt aditivo (texto + imagem + context refs) via `steer_turn` do canal `session_log` — nunca interrompe o run. Run parado → composer vira "resume com instruções" (`dispatchIssueAgent`) |
| Troca de agente | Mesma thread, próximo turno com o novo agente. `Thread.agent_kind` é a fonte de verdade: PATCH no thread; `AgentRunner.issue_agent_kind` e `IssueDispatch.effective_agent_kind` leem a thread antes de settings/labels. Troca desabilitada com run ativo |
| Guard backend | `send_message` em thread `issue_execution` retorna erro dedicado — turno interativo nunca inicia numa thread de execução |
| Tasks/Tools | Dock lateral no `IssueSessionSplitLayout`, mesmo nível de terminal/preview/environment; conteúdo derivado do feed unificado (`deriveAgentTasks` + timeline de tools). Painel pinado compacto permanece como resumo |
| URL | `/workspaces/<session-id>` é o endereço único para toda sessão, incluindo execução |
| Convivência | Nenhuma: `IssueExecutionSessionPanel`, `AgentTab`, `ExecutionChatPanel`, `ExecutionControlComposer`, `SessionLogTranscript`, `SessionLogEntryCard`, `SessionEventGroup`, `IssueSessionLog` são removidos na mesma entrega |

## 3. Inventário de porte (nada se perde)

- **Corpo (via adapter):** bolhas assistant/user/message; `reasoning` como
  disclosure colapsável ("Raciocínio interno"); eventos avulsos (incl. Token
  Count) como disclosures; grupos "N eventos" e "Executou N comandos";
  `tool_call`+`tool_result` pareados por `callId` com typed cards (command,
  search, preview, board, acceptance, evidence, kb, devenv, tunnel, MCP);
  `AgentTaskPinnedPanel`; scroll stickiness.
- **Chrome de execução:** `ExecutionStatusHeader` (status, long-running,
  retry, agente/turnos/runtime), `BundlePanel`, `ReturnToAgentPanel`.
- **Composer:** steer, fila de guidance, resume/start, stop, hard reset, goal
  (`GoalPill`), agente/model/effort, `ExecutionModeMenu`, magic commands,
  `GitDiffLauncher`, `ExecutionCommandPalette` + atalhos.
- **Shell:** docks terminal/preview/environment + novo dock Tasks/Tools, chip
  do identifier, "New session", handoffs de seed.

## 4. Fluxo

1. Abrir `/workspaces/<id>` → metadata da thread → `scope`.
2. `issue_execution`: corpo alimentado por `useSessionLogChannel({ sessionId })`
   + adapter; canal assistant só para metadata; composer com semântica
   steer/fila/resume; chrome de execução acima do corpo.
3. Interativo: comportamento atual inalterado.
4. Troca de agente (qualquer modo): PATCH `agent_kind` na thread → próximo
   turno/dispatch resolve pela thread.

## 5. Testes (WSL: um arquivo/filtro por vez, sequencial)

- Vitest: adapter (todos os kinds/cards, grupos, token count, ordem/keys);
  branch por scope; composer steer-vs-fila-vs-resume; PATCH de agente; tab
  Autonomous monta o painel unificado; dock Tasks/Tools.
- ExUnit: PATCH `agent_kind`; `issue_agent_kind`/`effective_agent_kind` leem a
  thread primeiro; guard de `send_message` para `issue_execution`.

## 6. Future (registrado, fora deste ciclo)

**Múltiplas execuções de orchestrador por workspace.** Desejo declarado:
1. Execução autônoma de um **tópico específico** sem o carregamento pesado do
   workpad da issue (prompt/goal direto numa working tree).
2. **child_runs de subissues** (Lab `bundle_child_orchestration`): cada unidade
   com sessão própria, chaveada por `(issue, unit_id)` — o metadata
   `unit_id`/`bundle_role` já é gravado por `ExecutionSession.create/3`; falta o
   `ensure/3` reusar por unidade em vez de por issue, e a UI listar N sessões de
   execução por workspace (o modelo threads-only do Workspaces já comporta).
