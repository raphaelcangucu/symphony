# Session auto-title (LLM) + magic rename

**Date:** 2026-07-16  
**Status:** implementing  
**Primary surface:** sidebar session list + assistant thread title  
**Related:**
[`2026-07-14-sidebar-sessions-perf-design.md`](./2026-07-14-sidebar-sessions-perf-design.md)
(sidebar projeto → sessão),
[`2026-07-15-new-session-modal-design.md`](./2026-07-15-new-session-modal-design.md)
(título opcional na criação),
`SymphonyElixir.Assistant.SideQuery` (turn curto sem tools),
`SymphonyElixir.Evidence.CommitMessageGenerator` (geração one-shot sem tools)

## 1. Problem

Sessões na sidebar frequentemente aparecem com nomes genéricos
(`Project session`, `Issue session`) ou fallbacks ruins
(`Session thread:7988` quando o id do nó é `thread:7988` e o título está
vazio). Já existe rename manual e título opcional na criação, mas a maioria
das sessões nunca recebe um nome descritivo. O chat já contém contexto
suficiente (ex.: cleanup goapi / GAM-19) para um título útil.

## 2. Goals

1. Gerar título via LLM a partir do início da conversa (primeira troca útil
   user + assistant).
2. Auto-gerar **uma vez** após essa troca, só para sessões **novas** (sem
   backfill em massa).
3. Manter rename manual.
4. Expor ícone/ação “mágica” que regenera o título e **sempre sobrescreve**
   (inclusive título editado à mão).
5. Atualizar a sidebar em tempo real quando o título mudar.

## 3. Non-goals

- Backfill automático de sessões antigas.
- Regenerar auto quando o assunto da conversa muda.
- Renomear a issue vinculada (só o título da thread/sessão).
- Confirmação antes do magic sobrescrever.
- Suites E2E amplas neste slice.

## 4. Decisions (approved)

| Tópico | Decisão |
|--------|---------|
| Fonte do nome | LLM a partir do início do chat |
| Timing auto | Uma vez, após 1ª troca útil (user + assistant) |
| Escopo auto | Só sessões criadas daqui pra frente |
| Rename manual | Permanece |
| Magic | Sempre disponível; regenera e sobrescreve direto |
| Arquitetura | Geração no backend Elixir; UI/API apontam para o mesmo gerador |

## 5. Architecture

Novo módulo `SymphonyElixir.Assistant.TitleGenerator` (padrão próximo de
`SideQuery` / `CommitMessageGenerator`):

1. Carrega mensagens iniciais do thread (pelo menos 1 user + 1 assistant).
2. Monta prompt curto pedindo **somente** um título (sem tools).
3. Normaliza a resposta (trim, strip de aspas / prefixo `Title:`, cap no
   limite de sidebar — 160 graphemes).
4. Persiste via `History.update_thread_sidebar_metadata/2`.
5. Notifica clientes (PubSub / channel event, alinhado ao update de metadata
   existente) para a sidebar refletir o novo título.

### Auto-title

Disparado no backend ao completar o primeiro turn assistant de uma thread
**elegível**:

- Thread criada após o cutover do feature (`inserted_at` ≥ cutover **ou**
  flag `title_auto_eligible` setada na criação — preferir flag explícita na
  criação para não depender de clock de deploy).
- Título ainda é default genérico (`Project session`, `Issue session`,
  `Workspace session`, `Telegram freeform chat`, vazio, ou equivalente
  localizado se algum dia for persistido assim).
- Metadata ainda **não** tem `title_auto_generated_at` (auto só uma vez).
- Job em background: não bloqueia o turn principal do chat.
- Falha do auto: silenciosa para o usuário; loga motivo; título default
  permanece.

Magic **ignora** `title_auto_generated_at` e **não** exige título genérico.

### Magic / manual

- Magic: `POST …/assistant/threads/:id/generate_title` → mesmo gerador;
  last-write-wins.
- Manual: fluxo atual `PATCH` title / `rename-thread` na sidebar.

## 6. API & data

### Endpoint

`POST /api/tracker/v1/assistant/threads/:id/generate_title`

- Success: `{ data: TrackerPresenter.assistant_thread(...) }` (ou
  `{ data: %{ title: ... } }` embutido no thread apresentado — preferir
  thread completo para o cliente reusar o mapper existente).
- Errors:
  - `404` thread not found
  - `422` `not_enough_context` (sem troca user+assistant suficiente)
  - `422` título inválido após normalização (raro; tratar como falha de
    geração)
  - `5xx` / erro tipado se o LLM falhar

### Metadata

No metadata JSON da thread (ou campos dedicados se já houver padrão):

- `title_auto_eligible: true` — set na criação pós-ship
- `title_auto_generated_at: iso8601 | null` — preenchido após auto bem-sucedido

Não exigir migration de schema se metadata JSON já cobrir; caso contrário,
campos boolean/datetime mínimos na tabela de threads.

## 7. UI

- Menu contextual da sessão: **Rename** (existente) + **Gerar nome** (magic /
  sparkles).
- Opcional: ícone magic no hover do título da sessão, se não poluir a lista.
- Estado `generating` no item (spinner no ícone); toast em falha; título
  atual permanece.
- Magic disponível em **qualquer** sessão com histórico suficiente (incluindo
  antigas); auto só nas elegíveis novas.
- Fallback de display: preferir título persistido; evitar
  ``Session ${nodeId}`` quando `nodeId` já é `thread:N` — usar
  ``Session ${threadId}`` ou o default de escopo. (Correção pequena de
  display, no mesmo slice se tocar o fallback.)

## 8. Title quality rules

- 3–8 palavras; sem aspas; sem prefixo `Title:`.
- Idioma alinhado ao chat (pt/en).
- Preferir assunto + ação (ex.: “Cleanup goapi GAM-19”), não meta
  (“Conversa com o assistente”).
- Cap: mesmo limite de sidebar (160 graphemes); UI trunca com ellipsis.

## 9. Error handling

| Caso | Comportamento |
|------|----------------|
| Auto falhou | Silencioso; log; mantém default |
| Magic falhou | Toast; título intacto |
| Sem contexto | Magic → 422 `not_enough_context` |
| Race (dois magics) | Last-write-wins no `title` |
| Usuário renomeia durante auto | Se auto só roda com título genérico, rename manual “ganha”; se auto já começou, last-write-wins (aceitável) |

## 10. Testing

- Unit (`TitleGenerator`): normalização; prompt com histórico mínimo;
  rejeição sem contexto.
- History / elegibilidade: auto só com flag + default title + sem
  `title_auto_generated_at`; magic sempre sobrescreve.
- Controller: `generate_title` persiste e devolve thread; erros tipados.
- Channel / turn hook: auto dispara uma vez após 1ª troca em thread
  elegível; não dispara em thread antiga.
- Tracker: ação magic + loading; rename manual intacto.

Restrição WSL: um arquivo/filtro de teste por vez.

## 11. Rollout

1. Ship gerador + endpoint + UI magic + rename existente.
2. Na criação de threads novas, setar `title_auto_eligible`.
3. Ligar hook de auto após 1º turn.
4. Sem job de backfill.

## 12. Open implementation notes

- Reutilizar runner/padrão de `CommitMessageGenerator` / `SideQuery` para
  evitar inventar outro stack de LLM.
- Escolher o ponto exato do hook pós-turn (channel vs agent session) onde já
  se sabe que o assistant message foi persistido.
- Evento de push: reusar broadcast de thread update se existir; senão
  `thread_title_updated` com `{ thread_id, title }`.
