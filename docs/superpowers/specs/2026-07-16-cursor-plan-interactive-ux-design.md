# Cursor Plan UX — MCP permissivo, Task/CreatePlan cards, ACP interativo

**Date:** 2026-07-16  
**Status:** implementing  
**Primary surfaces:** Cursor coding-agent adapter (`elixir` CliRunner / CodingAgent / ACP),
assistant transcript tool cards (`tracker` ToolCallBlock / toolCallDisplay)  
**Related:**  
[`2026-07-09-claude-ask-user-question-pretooluse-design.md`](./2026-07-09-claude-ask-user-question-pretooluse-design.md)
(Cursor listed as follow-up — this spec elevates that path),  
[`2026-06-26-execution-control-model-mode-plan.md`](../plans/2026-06-26-execution-control-model-mode-plan.md)
(`ExecutionMode.cursor_force?/1`),  
[`2026-07-15-new-session-modal-design.md`](./2026-07-15-new-session-modal-design.md)

## 1. Problem

Sessões Cursor em **Plan** e o transcript de tools deixam a experiência pobre:

1. **MCP rejeitado em Plan** — o CLI roda `--mode plan` **sem** `--force`. Tools
   MCP sem `readOnlyHint` voltam
   `{"rejected":{"isReadonly":false,"reason":"User rejected MCP: …"}}` mesmo
   quando são leituras (`get_issue`). O gateway Symphony já trata `get_issue`
   como read-only, mas o CLI rejeita antes.
2. **Task opaco** — subagents aparecem como `Task` + JSON cru;
   `subagentType` / `description` não aparecem no header (estilo Cursor IDE).
3. **CreatePlan opaco** — plano concluído é JSON; não dá para clicar e abrir o
   doc no KB para revisar.
4. **Permissões / perguntas falham** — o adapter usa `--print` / `stream-json`,
   que não bloqueia para resposta do usuário. Pedidos de permissão e
   `AskQuestion` falham ou “skip” em vez de abrir
   `CommandApprovalCard` / `UserQuestionsCard`.

Decisão de produto: ser **mais permissivo com MCP em Plan** (inclusive mutações
Symphony MCP), priorizando UX. Plan deixa de ser hard-sandbox no Cursor CLI.
Tudo abaixo é **um único escopo** (um spec, um implementation plan).

## 2. Goals

1. Em `execution_mode: plan`, MCP Symphony (leitura e escrita) **não** auto-rejeita.
2. Header de **Task** mostra tipo de subagente + description.
3. Card de **CreatePlan** mostra nome/overview, é clicável e abre o doc no KB;
   em turn interativo, Aceitar/Rejeitar desbloqueia o agente.
4. Em sessões interativas, permissões e perguntas ao usuário **aguardam** a UI
   (não falham na hora).

## 3. Non-goals

- Mudar Plan/sandbox de Codex ou Claude.
- Mentir `readOnlyHint: true` em tools mutáveis.
- Editor de plano inline ou sync bidirecional com o arquivo além do open no KB.
- Orquestrador headless com cards de approval/questions.
- UI dedicada além do card Aceitar/Rejeitar + Abrir no KB para `create_plan`.

## 4. Decisions

| Topic | Choice |
|-------|--------|
| MCP em Plan | **Permissivo** — todas as tools Symphony MCP permitidas no gateway |
| Cursor CLI Plan | Manter `--mode plan` **e** passar `--force` |
| Gateway `:deny_plan` | **Remover** — Plan não nega MCP no ToolGateway |
| Interactive Build approvals | **Mantém** — mutações MCP ainda pedem card em Build interativo |
| Task UI | Enrich header/metadata no path de view existente |
| CreatePlan UI | Card rico + click → KB; Aceitar/Rejeitar bloqueante via ACP |
| Permissões / AskQuestion / CreatePlan wait | **ACP** (`agent acp`) em sessões interativas |
| Escopo / ship | **Único** — um spec e um implementation plan cobrindo CLI, cards e ACP |

## 5. Architecture

Ordem sugerida no plano de implementação (não são ships separados):
CLI/gateway → cards Task/CreatePlan → transporte ACP + wiring dos cards
bloqueantes.

### 5.1 Cursor CLI + ExecutionMode

- `ExecutionMode.cursor_force?/1` → `true` para **todos** os modes normalizados
  (incluindo `plan`). Docs do módulo atualizam o contrato.
- `CliRunner.force_flag/1` alinhado (sempre `" --force"` quando o helper
  central for a fonte da verdade; evitar drift com lógica duplicada).
- Plan continua com `mode_flag("plan")` → `" --mode plan"`.
- Resultado efetivo em Plan (pré-ACP ou flags equivalentes no ACP):
  `--mode plan --force` (+ `--approve-mcps` / MCP do workspace quando houver).

**Trade-off explícito:** `--force` pode afrouxar também edits/shell no CLI.
Plan no UI permanece; o hard block de MCP some. Prompts de Plan
(“não implemente”) continuam.

### 5.2 Gateway Cursor

Em `SymphonyElixir.Cursor.CodingAgent.tool_gate/3`:

- Remover ramo `:deny_plan`.
- Read-only tools → `:allow` (como hoje).
- Interactive Build + mutação → `:require_approval` (como hoje).
- Caso contrário (inclui Plan) → `:allow`.

Atualizar testes em `coding_agent_test.exs` / `cli_runner_test.exs` /
`execution_mode` conforme o novo contrato.

### 5.3 Task card (tracker)

Em `assistantToolCallToView` / `toolCallDisplay` (e path de session log
equivalente):

- Detectar tool `Task` (e aliases Cursor se existirem).
- Header: `Task · {tipo}` onde `tipo` vem de `subagentType`:
  - string (`"explore"`, `"shell"`, …) → label humanizado
  - `{ "unspecified": {} }` / ausente → `Subagent`
  - `{ "custom": "x" }` → `x`
- Metadata: `description` truncada.
- Detalhe expandido: JSON ENT/SAÍ como hoje.

### 5.4 CreatePlan card (tracker)

- Detectar tool `CreatePlan` / `create_plan` (e payload ACP equivalente).
- Header: `Plan · {name}` (fallback `Plan`).
- Metadata: `overview` truncado.
- **Abrir no KB:** `openKnowledgeBase(path)` (mesmo path do composer KB).
- Resolução do path (ordem):
  1. `planUri` se presente no args/resultado / resposta ACP
  2. primeiro link `docs/.../*.md` (ou path normalizável) no markdown `plan`
  3. se não resolver → expandir markdown no detalhe + toast (sem abrir KB vazio)
- Detalhe expandido: preferir markdown do `plan` (não só JSON).
- Em turn interativo (ACP): ações **Aceitar** / **Rejeitar** além de Abrir no KB.
  Abrir no KB **não** resolve o request sozinho.

### 5.5 ACP interativo

Substituir o transporte `--print` / `stream-json` nas **sessões interativas**
do assistant por **`agent acp`** (JSON-RPC stdio), reutilizando os cards já
existentes no composer.

| Evento ACP | UI Symphony | Resposta |
|------------|-------------|----------|
| `session/request_permission` | `CommandApprovalCard` | `allow-once` / `allow-always` / `reject-once` |
| `cursor/ask_question` | `UserQuestionsCard` | `answered` / `skipped` / `cancelled` |
| `cursor/create_plan` | Card Plan (Aceitar / Rejeitar / Abrir no KB) | `accepted` (+ `planUri` opcional) / `rejected` / `cancelled` |
| `session/update` (+ tools / `cursor/task`) | transcript + cards Task/CreatePlan | — |

**Comportamento:**

- Turn fica **bloqueado** até resposta da UI ou timeout do broker (mesmo order
  de magnitude dos brokers atuais, ~5 min). Timeout → deny/skip com motivo
  claro — **não** auto-falhar imediato.
- Orquestrador / turns não interativos: sem cards; política headless atual
  (deny/skip documentado) permanece.
- Plan em ACP: mode `plan` + force/permissões alinhados a §5.1–5.2 (MCP
  permissivo).
- Auth ACP: reutilizar login/`CURSOR_API_KEY` já usados pelo CLI.

**Migração:** manter bridge de eventos bridge-style (`item/progress`,
`tool_call`, …) a partir de `session/update` para não reescrever o transcript
inteiro. Escopo mínimo: streaming de texto + tool calls + os três blocking
methods acima.

Eleva o “Cursor follow-up” de
`2026-07-09-claude-ask-user-question-pretooluse-design.md` § Cursor para
trabalho concreto neste spec.

## 6. Data flow (ACP)

```text
UI (approve / answers / accept plan)
  → AssistantChannel
  → ApprovalBroker / UserInputBroker (ou broker ACP unificado)
  → Cursor ACP client (JSON-RPC response no stdin do agent)
  → turn continua
```

Inbound:

```text
agent acp stdout
  → session/request_permission | cursor/ask_question | cursor/create_plan
  → on_approval_required / on_user_input_required / on_create_plan_required
  → channel push → cards no ProjectAssistantPanel
```

## 7. Error handling

| Caso | Comportamento |
|------|----------------|
| MCP em Plan | Executa; erros de negócio da tool como hoje |
| Path KB CreatePlan não resolve | Toast; detalhe mostra markdown |
| Timeout approval/questions/plan | Deny/skip com mensagem explícita no transcript |
| ACP crash / disconnect | `turn/failed` com motivo; sem card órfão |
| Double-submit no card | Idempotente (mesmo request_id) |

## 8. Testing

### Elixir

- `cursor_force?("plan")` == true; args Plan incluem mode plan + force (ou
  equivalente ACP).
- Gateway Plan: `create_issue` e `get_issue` executam (sem “Plan mode is read-only”).
- Interactive Build ainda pausa mutações no ApprovalBroker.
- Fake ACP: `request_permission` → card → approve → JSON-RPC response.
- `ask_question` → UserQuestionsCard → answered retoma turn.
- `create_plan` → Aceitar com `planUri` opcional; Abrir no KB não resolve o
  request sozinho.

### Tracker

- Task args com `subagentType: "explore"` → header `Task · Explore` + description.
- `subagentType: { unspecified: {} }` → `Task · Subagent`.
- CreatePlan com link `docs/.../….md` no `plan` → click chama open KB com path
  resolvido.
- CreatePlan sem path → não abre KB vazio; mostra overview/markdown.

WSL: um arquivo ou filtro por vez.

## 9. File map (hint)

| Area | Files |
|------|--------|
| Force / mode | `elixir/lib/symphony_elixir/execution_mode.ex`, `cursor/cli_runner.ex` |
| Gateway gate | `elixir/lib/symphony_elixir/cursor/coding_agent.ex` + tests |
| Task / CreatePlan views | `tracker/src/lib/toolCallDisplay.ts`, `assistant/assistantToolCall.ts`, sessionToolCall path, ToolCallBlock se precisar de click handler |
| KB open | `ProjectAssistantPanel` / markdown link helpers já existentes |
| ACP | novo client ACP sob `elixir/lib/symphony_elixir/cursor/`, wire em `assistant_channel.ex` / `agent_session.ex` |
| i18n | labels Task/Plan/Subagent se necessário |

## 10. Success criteria

1. Sessão Cursor Plan chama `symphony-get_issue` (e outras MCP Symphony) sem
   `User rejected MCP` por `isReadonly`.
2. Task em execução mostra `Task · Explore` (ou tipo real) + description no
   header.
3. CreatePlan: click abre o markdown no KB quando o path resolve; Aceitar/Rejeitar
   desbloqueia o turn; Abrir no KB é ação auxiliar.
4. Pedido de permissão e pergunta ao usuário abrem cards e retomam o turn após
   resposta — sem falha imediata.

## 11. Open points (resolved in brainstorm)

| Point | Resolution |
|-------|------------|
| MCP Plan policy | Permissivo (inclui mutações Symphony MCP) |
| CLI approach | `--mode plan` + `--force` |
| Escopo | Único spec + único implementation plan (CLI, cards, ACP) |
| CreatePlan | Card + KB open + Aceitar/Rejeitar via ACP |
