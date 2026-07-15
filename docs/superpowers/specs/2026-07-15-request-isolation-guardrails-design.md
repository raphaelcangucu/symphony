# Request Isolation Guardrails — Design

> Impede que uma requisição lenta ou um payload grande (ex.: thread `8006` com
> ~3,37 MB de `tool_calls`) monopolize a fila do SQLite, um GenServer
> compartilhado, ou a main thread do React e congele rotas não relacionadas.
> Implementa a **Opção A (Proteções Incrementais)** aprovada pelo usuário.

**Status:** draft for review
**Related:**
[`2026-07-15-workspace-messages-perf-plan`](../plans/2026-07-15-workspace-messages-perf-plan.md),
[`2026-07-14-sidebar-sessions-perf-design.md`](./2026-07-14-sidebar-sessions-perf-design.md)

## 1. Problema (evidência)

Ao abrir `/tracker/projects/advising/workspaces/8006` a interface congelava:

| Sintoma | Causa medida |
|---------|--------------|
| Reload transferia o histórico duas vezes | `join/3` retornava `join_history_payload` (com `messages`) **e** reenfileirava o mesmo payload via `history_loaded`; o frontend só consome `messages` do `history_loaded` |
| Payload de reload pesado | Um único `tool_calls` histórico chegava a ~3,37 MB; a captura só era feita no boundary do history, mas o payload de join duplicava |
| Scan de inventory podia travar o chamador | `@scan_timeout :infinity` em `Task.await/2` e `Task.async_stream/3`; um `du`/`git` preso bloqueava o processo indefinidamente |
| Cold misses duplicavam trabalho de CLI/git | `HotpathCache` fazia `fetch → miss → build → put`; N requisições concorrentes recomputavam o mesmo catálogo/tree em paralelo |
| Sem visibilidade | Nenhuma métrica de duração, bytes de payload, timeout, cache-hit, nem log de fila lenta do SQLite |
| Main thread do React bloqueava | `assistant_delta` disparava `setState` por evento; sem batching por frame; mensagens estáveis re-renderizavam durante o streaming; um bloco de markdown/tool malformado derrubava navegação e composer |
| Requisições HTTP sem deadline | `http.ts` (axios) sem `timeout` default; requests de rota não eram cancelados no unmount |

## 2. Objetivos

1. `join/3` responde rápido com metadados leves; o histórico capado/paginado é
   empurrado **uma vez** após o join (sem duplicação).
2. Reusar os budgets de [`history.ex`](../../elixir/lib/symphony_elixir/assistant/history.ex)
   em todos os boundaries voltados ao cliente (join, sync, páginas antigas,
   reconciliação de conclusão), mantendo o output completo buscável sob demanda.
3. Inventory scan com deadline finito, concorrência limitada e resultados
   explícitos de timeout/erro; nunca no caminho crítico de sidebar/bootstrap.
4. `HotpathCache` com single-flight por chave e stale-on-refresh.
5. Telemetria estruturada (duração, bytes, timeout, cache-hit) nos caminhos de
   history, inventory e recomputação de hotpath; log de fila/consulta lenta do
   SQLite via telemetria Ecto existente.
6. Frontend responsivo sob lentidão/streaming: timeout default nomeado +
   cancelamento por rota; batching de deltas por animation frame; memoização de
   render estável; error boundary de sessão com estados de timeout/retry.

## 3. Não objetivos

- Aumentar `pool_size` do SQLite ou migrar o banco.
- Sharding do `TurnManager`, read replica, virtualização de lista, ou Web Worker.
- Qualquer perda ou truncamento destrutivo do output de tool persistido.
- Refatorar o bundle principal (registrar o chunk de 3,86 MB como follow-up).

## 4. Contratos e budgets

| Boundary | Budget/deadline | Constante / origem |
|----------|-----------------|--------------------|
| Cap de output de tool no payload de history | `8_192` bytes por output (UTF-8 safe) | `@history_tool_output_cap_bytes` em `assistant_channel.ex` / `History.message_payload/2` `:cap_tool_output_bytes` |
| Página de mensagens (join/sync/older) | `40` mensagens | `@history_page_limit` |
| Join reply | Somente metadados leves (sem `messages`); histórico via `history_loaded` | `join_metadata_payload/1` |
| Output completo de tool | Sob demanda, thread-scoped | `fetch_tool_output` → `History.tool_call_output/3` |
| Inventory scan | Deadline finito por probe + timeout total; `on_timeout: :kill_task`; resultado `{:error, :timeout}` localizado | `@scan_timeout` finito + `:scan_timeout` opt |
| Inventory concorrência | `max(System.schedulers_online(), 4)`, sobreponível | `:max_concurrency` opt |
| HotpathCache single-flight | 1 recomputação por chave; concorrentes esperam o líder | `HotpathCache.fetch_or_store/4` |
| HotpathCache stale window | Serve valor stale e revalida em background (opcional) | `:stale_ms` opt |
| HTTP client (frontend) | `timeout` default nomeado (`DEFAULT_HTTP_TIMEOUT_MS`) + `AbortSignal` | `http.ts` |
| Delta flush | No máx. 1 flush por animation frame; flush síncrono final antes de completed/error | `ProjectAssistantPanel` delta buffer |

### 4.1 Semântica de cancelamento

- **Servidor:** timeout/deadline de inventory vira `{:error, :timeout}` para
  aquela probe/scan; nunca uma espera indefinida nem crash do chamador.
  `HotpathCache` degrada para computação direta se o líder não entregar dentro
  da janela de espera (garante progresso).
- **Frontend:** requisições de rota (projects/sessions/thread) recebem um
  `AbortSignal` e são canceladas no unmount ou na troca de chave de rota.
  Cancelamento **não** vira erro visível ao usuário (`axios.isCancel` /
  `CanceledError` é engolido). Timeout real vira estado de retry explícito, não
  loading infinito.

### 4.2 Campos de telemetria

Eventos `:telemetry.execute/3` sob o prefixo `[:symphony, ...]`:

| Evento | Measurements | Metadata |
|--------|--------------|----------|
| `[:symphony, :assistant, :history]` | `duration_ms`, `payload_bytes`, `message_count` | `thread_id`, `source` (`:join`/`:sync`/`:older`) |
| `[:symphony, :inventory, :scan]` | `duration_ms`, `workspace_count` | `project_slug`, `result` (`:ok`/`:timeout`/`:error`) |
| `[:symphony, :hotpath, :recompute]` | `duration_ms` | `key`, `outcome` (`:computed`/`:coalesced`/`:stale_refresh`) |
| `[:symphony, :hotpath, :fetch]` | `count: 1` | `key`, `hit` (`:fresh`/`:stale`/`:miss`) |
| `[:symphony_elixir, :repo, :query]` (Ecto existente) | `queue_time`, `query_time`, `total_time` | logado como `warning` acima de `SLOW_QUEUE_MS` / `SLOW_QUERY_MS` |

Thresholds de log lento (SQLite single-writer): `queue_time > 50 ms` ou
`query_time > 100 ms` emite um `Logger.warning` estruturado. Não cria scheduler
próprio; apenas anexa um handler ao evento Ecto já emitido.

## 5. Arquitetura

```text
Request (HTTP ou Channel)
  → ack rápido + metadados leves
  → task limitada com deadline
  → payload paginado e byte-budgetado
  → update de UI bufferizado/transicionado
  → render compacto e memoizado
```

- Uma requisição nunca executa scan/CLI/serialização de MB/espera externa dentro
  de um GenServer compartilhado no caminho síncrono.
- `Repo` permanece `pool_size: 1`; reduzimos ocupação da fila encurtando
  queries, serialização e trabalho em processos compartilhados.
- Timeout/cancelamento é falha localizada com estado de retry, nunca loading
  indefinido.

## 6. Testes (focados, um arquivo por vez sob WSL)

**Backend**
- `assistant_channel_test.exs`: join reply leve (sem `messages`); `history_loaded`
  empurrado uma vez com histórico capado/paginado.
- `history_test.exs`: budgets de cap/paginação reusados por sync/older.
- `inventory_test.exs`: deadline finito → `{:error, :timeout}` localizado; sem
  travar o chamador; concorrência limitada.
- `hotpath_cache_test.exs`: single-flight (uma computação para N misses
  concorrentes); stale-on-refresh; expiração.
- `observability/metrics_test.exs` + handler de query lenta.

**Frontend**
- `http.test.ts` / serviço: timeout default; cancelamento não vira erro visível.
- `assistantStream.test.ts`: coalescing ordenado, cleanup, flush terminal.
- `ProjectAssistantPanel.test.tsx`: batching por frame; flush síncrono no
  completed/error; error boundary.
- `AssistantChatMessageBubble.test.tsx`: memoização (sem re-render de histórico
  estável durante streaming).

## 7. Resumo da decisão

- **Servidor:** join leve + push único; budgets reusados; inventory com
  deadline; hotpath single-flight; telemetria + log de fila lenta.
- **Frontend:** timeout + cancelamento por rota; batching de deltas por frame;
  memoização; error boundary com retry.
- **Preservado:** SQLite single-writer, output completo durável e buscável,
  ausência de sharding/virtualização/pool changes.
