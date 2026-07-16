# Tool call typed cards — normalizer + UI por família

**Date:** 2026-07-16  
**Status:** implemented  
**Primary surfaces:** assistant chat + autonomous session log (`tracker` ToolActivityItem / ToolCallBlock / sessionToolCall)  
**Visual mock:** [`../mocks/2026-07-16-tool-call-cards-mock.html`](../mocks/2026-07-16-tool-call-cards-mock.html)  
**Related:**  
[`2026-07-16-cursor-plan-interactive-ux-design.md`](./2026-07-16-cursor-plan-interactive-ux-design.md) (Task / CreatePlan cards — keep),  
[`2026-07-16-cli-agent-session-transcript-design.md`](./2026-07-16-cli-agent-session-transcript-design.md) (autonomous transcript source)

## 1. Problem

Tool calls de Cursor, Codex e Claude chegam ao transcript como **JSON ENT/SAÍ**.
Para um usuário comum isso é ilegível: `parsingResult`, `simpleCommands`,
wrappers `content[].text.text`, IDs internos e paths absolutos dominam a tela.

Sessão real **CDE-1180** (`cursor-session.jsonl`): 32 tool uses —
Read 9 · Bash 8 · Mcp 8 · Grep 4 · Glob 3. O agente descreve bem
(“Run GranteeAutocomplete unit tests”), mas a UI mostra o payload bruto.

Já existem cards parciais (`FileActivityCard`, `AgentTaskInlineCard`,
`CreatePlanCard`), mas aliases entre agentes e quase todo MCP caem no
`ToolCallBlock` genérico.

## 2. Goals

1. Usuário comum entende **o que o agente fez** sem ler JSON.
2. Uma camada `canonicalizeToolCall()` unifica Cursor / Codex / Claude
   (assistant + autonomous).
3. Cards tipados por família; JSON só em “Detalhes técnicos”.
4. Sandbox `/dev/tool-call-proposals` com before/after (timeline CDE-1180 + KB/DevEnv).
5. Incluir no v1: KB fino, DevEnv dedicado, faixa **Worked for…**.

## 3. Non-goals

- Mudar wire format dos agentes ou parsers Elixir além do necessário para
  campos já presentes no transcript.
- Editor inline de páginas KB ou de steps de DevEnv.
- Substituir `CreatePlanCard` / approval / ask-question flows.
- Syntax highlighting rico ou terminal emulator completo.
- i18n perfeita de todas as strings de domínio na primeira PR (usar chaves
  existentes + novas mínimas; pt-BR + en).

## 4. Decisions

| Topic | Choice |
|-------|--------|
| Abordagem | **Normalizer + cards tipados** (não só polish genérico do ToolCallBlock) |
| Densidade | Card médio com resumo útil; detalhe/raw no expand |
| Escopo de superfície | Assistant **e** autonomous (mesmo router) |
| MCP Cursor `name: "Mcp"` | Resolver via `toolName` / `name` interno antes do router |
| Ruído Bash | Nunca renderizar `parsingResult`, timeouts, conversationId na UI principal |
| Output MCP aninhado | Unwrap `success.content[].text.text` (e equivalentes) no normalizer |
| Task / Plan | Manter cards existentes; não reimplementar |
| Worked for… | Faixa de fim de turn com duração + contagens por família |
| Ship | Um spec → um implementation plan; sandbox primeiro, depois wire no produto |

## 5. Architecture

```
AssistantToolCall | SessionLogPair
        ↓
 canonicalizeToolCall()
        ↓
 ToolPresentation { family, title, summary, badges, body?, raw?, links? }
        ↓
 ToolActivityItem / SessionToolActivityGroup
        ↓
 Card(family) | GenericToolCard (fallback)
```

### 5.1 Canonicalization

Novo módulo: `tracker/src/lib/toolCallCanonicalize.ts`.

**Entrada:** forma assistant (`name`, `arguments`, `output`, `status`, …) **ou**
par session-log (`title`/`body`/`language`/`callId`).

**Aliases → family:**

| Family | Nomes / sinais |
|--------|----------------|
| `command` | `Bash`, `Shell`, `shell`, `bash`, `exec_command` |
| `file_read` | `Read`, `read`, `read_file`, `read_workspace_file` |
| `file_edit` | `edit`, `write`, `Write`, `apply_patch`, `edit_file`, `write_file` |
| `search` | `Grep`, `grep`, `Glob`, `glob`, `semsearch`, `SemanticSearch` |
| `preview` | `manage_preview`, `list_previews`; health-wait Bash heurística |
| `board_query` | `list_*`, `get_*` (exceto evidence/preview), `list_comments`, … |
| `board_action` | `set_issue_status`, `move_issue`, `create_issue`, `dispatch_*`, … |
| `evidence` | `get_evidence_status`, `check_handoff_gate` |
| `acceptance` | `update_acceptance_criteria` |
| `kb` | `kb_*` |
| `devenv` | `manage_dev_env` |
| `tunnel` | `manage_tunnel` |
| `task` / `create_plan` | existentes |
| `generic_mcp` | MCP/Symphony restante |
| `other` | fallback |

**Extração de campos úteis:** `description`, `command` (encurtado), `path`
(relativo quando possível), `pattern`, `action`, `exitCode`, `executionTime`,
URLs de preview/tunnel, `issue_id`/`status`, gate evidence, KB
`repository`+`path`, DevEnv `steps`/`port`/`status`.

**Unwrap de output:** tentar JSON parse; se houver `success` / `content[]` /
`text.text`, promover o payload interno para `body` tipado e guardar o
original em `raw`.

### 5.2 Router

Estender `ToolActivityItem` (e path session equivalente):

1. Task / CreatePlan existentes (sem regressão).
2. `family` → card tipado.
3. Senão → `GenericToolCard` (evolução do `ToolCallBlock`: header humano,
   chips, raw colapsado).

`FileActivityCard` pode ser reusado/estendido para `file_read` / `file_edit` /
`command` **depois** da canonicalização (aliases Cursor/Claude passam a bater).

### 5.3 Cards (v1)

| Card | Family | Header (exemplo) | Badges / links |
|------|--------|------------------|----------------|
| CommandCard | `command` | description + cmd curto | exit, tempo, avisos; PR #N se detectado |
| FileGlanceCard | `file_read` / `file_edit` | path relativo | lido / +N −M |
| SearchCard | `search` | pattern | grep/glob · escopo |
| PreviewCard | `preview` | ação + identifier | status server · abrir URL |
| HealthWaitCard | `preview` (heurística) | “Aguardando health check” | em execução |
| BoardQueryCard | `board_query` | verbo + entity | contagem |
| BoardActionCard | `board_action` | “CDE-1180 movido” | ok / failed |
| EvidenceCard | `evidence` | gate | satisfied / violações |
| AcceptanceCard | `acceptance` | atualizou / erro amigável | warn |
| KbCard | `kb` | buscou / criou / atualizou / linkou / delete | hits · abrir no KB · destrutivo |
| DevEnvCard | `devenv` | warm_up / list_steps / run_step | status · port · lista de steps |
| TunnelCard | `tunnel` | túnel ligado/status | running · URL pública |
| GenericToolCard | `generic_mcp` / `other` | label humana + chips de args | detalhe técnico |
| TurnSummaryStrip | (agregado) | **Worked for Xm Ys** | chips por família |

Agrupamentos existentes (`ToolActivityGroup` / cluster “Leu N arquivos”)
permanecem; TurnSummaryStrip aparece no **fim do turn** (assistant) e pode
espelhar no footer de um bloco autonomous quando houver timestamps.

### 5.4 Heurísticas

- **Health-wait:** comando com `curl` + `sleep` + loop/`seq` → HealthWaitCard
  (não CommandCard genérico).
- **PR link:** stdout/`gh pr list` JSON com `url`+`number` → badge link.
- **KB destrutivo:** `kb_delete_*` → badge warn “destrutivo”.
- **Path display:** preferir últimos 2–3 segmentos; full path no expand.

### 5.5 Sandbox

Rota: `/dev/tool-call-proposals` (padrão de
`AssistantSessionLayoutProposalsPage`).

- Coluna before: `ToolCallBlock` / JSON cru com fixtures CDE-1180.
- Coluna after: cards tipados + TurnSummaryStrip + amostras KB/DevEnv/Tunnel.
- Sem Phoenix: dados mockados tipados como `ToolPresentation[]`.

O HTML em `docs/superpowers/mocks/` é companion de brainstorm; a página React
é a fonte de verdade para review de produto no app.

## 6. Data flow (assistant vs autonomous)

| Path | Hoje | Depois |
|------|------|--------|
| Assistant | `assistantToolCallToView` → ToolCallBlock; fileActivity opcional | canonicalize → router → card |
| Autonomous | `sessionPairToView` → ToolCallBlock (quase sempre JSON) | mesmo canonicalize + router |
| Grouping | `toolCallGroups` por kind grosso | continua; family pode informar labels |

Não duplicar parsers: session-log converte para um shape mínimo
(`name`/`args`/`output`/`status`) **antes** do canonicalize.

## 7. Error handling

- Parse JSON falha → tratar output como texto; family ainda pelos nomes.
- Family conhecida mas schema inesperado → card da family com summary
  degradado + raw expandido (não cair em tela só-JSON).
- Truncation / load full output: GenericToolCard e CommandCard preservam o
  controle atual de `outputTruncated`.
- Failed status: badge failed vermelho; mensagem amigável quando houver
  `error.message` conhecido (ex.: acceptance criteria).

## 8. Testing

- Unit: `toolCallCanonicalize` com fixtures derivadas de CDE-1180
  (Bash description/command/exit; Mcp→manage_preview unwrap; Grep pattern;
  aliases Claude/Codex).
- Unit: heurística health-wait; unwrap MCP; KB path chips.
- Component: um smoke render por family no sandbox ou testes leves de card
  (summary visível, raw não visível por default).
- Regressão: Task / CreatePlan / FileActivity paths existentes continuam
  verdes.
- WSL: um arquivo/filtro de teste por vez (regra do workspace).

## 9. Rollout

1. `toolCallCanonicalize` + testes.
2. Cards + GenericToolCard + sandbox `/dev/tool-call-proposals`.
3. Wire `ToolActivityItem` (assistant).
4. Wire session-log autonomous.
5. TurnSummaryStrip no fim do turn.
6. Polish i18n / paths relativos / links KB.

## 10. Open questions (resolved in design)

| Question | Resolution |
|----------|------------|
| Só mock ou produto? | Produto (assistant + autonomous); mock é prova visual |
| Densidade | Médio com expand (não só one-liner) |
| KB / DevEnv / Worked for no v1? | **Sim** |
| Visual | Aprovado via mock HTML (aba Timeline + KB·DevEnv·Turn) |

## 11. Mock reference (accepted)

- Timeline mista: Preview / Command / Board / File cluster / Search / Evidence
  + Worked for strip.
- Foco Bash: exit + avisos + PR link.
- Foco MCP: preview / evidence / acceptance / query.
- KB · DevEnv · Turn: KbCard variants, DevEnvCard steps, TunnelCard,
  TurnSummaryStrip.
