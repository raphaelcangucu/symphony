# Nova sessão — modal Livre / Projeto

**Date:** 2026-07-15  
**Status:** implementing  
**Note:** “Explorar projeto” creates a new `project_session` on the chosen
workspace (not the singleton `project_explore` ensure), so each “Criar sessão”
yields a distinct thread while keeping the explore intent in the UI.  
**Primary surface:** `tracker` sidebar — `SidebarNewSessionFlow`  
**Related:**
[`2026-07-14-session-agent-mode-fields-design.md`](./2026-07-14-session-agent-mode-fields-design.md)
(campos agente / model / effort),
[`2026-07-14-sidebar-sessions-perf-design.md`](./2026-07-14-sidebar-sessions-perf-design.md)
(contexto sidebar projeto → sessão)

## 1. Problem

O modal **Nova sessão** hoje só cobre sessão de projeto: projeto + workspace +
título + agente. Isso não expressa os caminhos reais do produto:

1. **Sessão livre** — gerir o próprio tracker (projetos, tasks, orquestração),
   já suportada no backend como `freeform`, mas fora deste modal.
2. **Sessão de projeto em issue** — autocomplete de issue, com workspace
   existente da issue ou criação sob demanda (`issue_session`).
3. **Explorar projeto** — dúvidas / exploração no workspace (default
   editável), sem amarrar a uma issue (`project_explore`).

“Criar issue” **não** deve ser um tipo do modal: o fluxo atual via assistant
(conversa → `create_issue` → attach à sessão) permanece a fonte da verdade.

## 2. Goals

- Um único dialog, form contínuo (sem wizard), com campos condicionais.
- Tipos de topo: **Livre** | **Projeto**.
- Em Projeto: seletor de projeto sempre visível; subtipos **Issue** |
  **Explorar projeto**.
- Agente + model + effort sempre visíveis, reutilizando os field wrappers do
  spec de mode fields.
- Seed prompt opcional em ambos os tipos; se preenchido, vira a primeira
  mensagem após criar a thread.
- Título opcional, com fallback determinístico.
- Defaults a partir do contexto da sidebar quando houver projeto selecionado.

## 3. Non-goals

- Tipo “criar issue” / formulário de issue no modal.
- Wizard multi-step ou cards de escolha como primeiro passo.
- Redesign do assistant `create_issue` / attach.
- Unificar fisicamente workspaces no filesystem além do create/reuse já
  existente para issue sessions.
- Suites E2E amplas neste slice (salvo VALIDATE de issue que peça).

## 4. Decisions

| Topic | Choice |
|-------|--------|
| Layout | **A** — form único com campos condicionais |
| Tipos de topo | Livre \| Projeto |
| Subtipos Projeto | Issue \| Explorar projeto |
| Projeto (campo) | Sempre no ramo Projeto; pré-fill se sidebar tiver contexto; editável |
| Explorar → workspace | Campo visível; default do projeto; editável |
| Issue → workspace | Reusa o associado à issue; cria se não existir |
| Título | Opcional; fallback: seed truncado → id/título da issue → “Nova sessão” |
| Seed | Opcional nos dois tipos; vazio = sessão abre sem mensagem inicial |
| Criar issue | Fora do modal (assistant) |
| Default tipo ao abrir | Projeto se sidebar tem projeto; senão Livre |
| Agent/model/effort UI | Wrappers compartilhados do spec 2026-07-14 |
| Escopo de código | Evoluir `SidebarNewSessionFlow`, não um segundo modal paralelo |

## 5. UX structure

Ordem dos campos no dialog:

1. **Título da sessão** (opcional)
2. **Tipo** — segmented control: `Livre` | `Projeto`
3. **Campos do tipo** (condicionais; ver abaixo)
4. **Agente · Model · Effort** (sempre)
5. **Seed prompt** (textarea opcional)
6. Footer: Cancelar · Criar sessão

### 5.1 Livre

- Propósito: operar o tracker (projetos, tasks, etc.), sem workspace de código
  de um repo de produto.
- Campos extras: nenhum além de agente / model / effort / seed.
- Scope da thread: `freeform`.

### 5.2 Projeto

Sempre:

- **Projeto** — select; pré-preenchido pelo `selection` da sidebar quando
  houver `projectSlug`; usuário pode trocar.

Subtipo segmented: `Issue` | `Explorar projeto`.

**Issue**

- Autocomplete de issues **no projeto escolhido**.
- Ao criar: `issue_session`; workspace existente da issue ou create + associate
  (flags/caminhos já usados por `createIssueSessionThread` /
  `StartIssueSessionDialog`).

**Explorar projeto**

- **Workspace** visível, pré-preenchido com o default do projeto, editável.
- Scope: `project_session` no `workspace_path` escolhido (nova thread a cada
  create; o singleton `project_explore` continua na página Explore dedicada).

## 6. Create behavior

### 6.1 Defaults ao abrir

| Campo | Regra |
|-------|--------|
| Tipo | `Projeto` se sidebar tem projeto; senão `Livre` |
| Projeto | slug da seleção atual (editável) |
| Subtipo Projeto | default `Explorar projeto` se não houver issue na seleção; `Issue` se a seleção for uma issue (pré-fill do autocomplete) |
| Workspace (Explorar) | default do projeto |
| Agente | default do projeto (Projeto) ou default global (Livre) |
| Model / Effort | defaults do catálogo para o agente escolhido |
| Título / Seed | vazios |

### 6.2 Submit

1. Validar: Projeto exige projeto; Issue exige issue; Explorar exige workspace.
2. Resolver título (fallback acima).
3. Criar thread no scope correto com `agent_kind` + metadata `model` / `effort`.
   Execution mode segue os defaults já existentes por scope (ex.:
   `project_explore` → `plan` locked; `issue_session` → default de create atual),
   sem expor seletor de mode neste modal.
4. Se seed não-vazio: enviar como primeira mensagem no path do composer/channel.
5. Navegar para a sessão criada; fechar modal.
6. Guard contra double-submit (manter o do flow atual).

### 6.3 Erros

- Validação local bloqueia submit com mensagem inline.
- Erro de API: mensagem no dialog, modal aberto, botão reabilitado.

## 7. Architecture

### 7.1 Frontend

| Peça | Papel |
|------|--------|
| `SidebarNewSessionFlow` | Único host do dialog; state machine de tipo/subtipo; submit |
| Field wrappers agent/model/effort | Reuso do spec 2026-07-14 |
| Issue autocomplete | Padrão existente de busca de issues do projeto |
| `assistantThreads` | `createFreeformThread`, `createIssueSessionThread`, create/ensure `project_explore` com workspace |
| Catalog bundle | `fetchAssistantCatalogBundle` quando o dialog abre (model/effort) |

### 7.2 Backend

Estender create apenas onde faltar paridade com o modal:

- **`freeform`:** aceitar/persistir `agent_kind`, `model`, `effort` se ainda não
  aceitar (mesmo padrão de metadata do spec de mode fields).
- **`project_explore`:** create explícito com `project_slug`, `workspace_path`,
  `agent_kind`, `model`, `effort`, `title` se o path atual for só
  `ensure_project_explore_thread` sem esses campos.
- **`issue_session`:** reusar create existente (já com model/effort / workspace
  options).

Não inventar scope novo.

### 7.3 Seed → primeira mensagem

Após create bem-sucedido, se `seed.trim()` ≠ `""`, chamar o mesmo caminho que o
composer usa para enviar a primeira turn na thread nova (channel/HTTP já usado
pela sessão). Falha no send: sessão já existe; mostrar erro não-bloqueante
(toast ou banner) e ainda navegar para a thread.

## 8. Testing

### Tracker (component)

Estender testes de `SidebarNewSessionFlow` / host da utility nav:

- Sem projeto na sidebar → default Livre; com projeto → Projeto + projeto
  pré-preenchido.
- Toggle Livre ↔ Projeto mostra/oculta campos.
- Issue vs Explorar: autocomplete vs workspace editável.
- Título vazio → fallback seed / issue / “Nova sessão”.
- Seed vazio não chama send; seed preenchido chama send após create.
- Submit desabilitado sem projeto (Projeto) / sem issue (subtipo Issue).
- Double-submit não cria duas threads.

### Elixir

Um teste de controller por path novo ou campo novo em
`freeform` / `project_explore` create.

### WSL

Um arquivo ou filtro por vez; sem suites repository-wide.

## 9. File map (implementation hint)

| Area | Files (expected) |
|------|------------------|
| Modal | `tracker/src/components/layout/sidebar/SidebarNewSessionFlow.tsx` |
| i18n | strings do tracker para Livre / Projeto / Issue / Explorar / seed |
| Threads API client | `tracker/src/services/assistantThreads.ts` |
| Tests | `tracker/src/components/layout/sidebar/__tests__/…` (flow host) |
| Backend create | `elixir` assistant thread controller + `History` create helpers |
| Shared fields | wrappers do spec 2026-07-14 (já existentes ou no mesmo PR se ainda não) |

## 10. Open points (resolved in brainstorm)

| Point | Resolution |
|-------|------------|
| Criar issue no modal? | Não — assistant only |
| Seed em Livre? | Sim, opcional |
| Workspace em Explorar | Visível, default, editável |
| Título | Opcional com fallback |
| Chrome | Form único (A), não wizard |

Nenhum TBD restante para v1 deste modal.
