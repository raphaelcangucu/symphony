# Commit list pagination + online status

**Date:** 2026-07-16  
**Status:** Approved for planning  
**Domain:** Tracker Diff modal (Commits tab), Ambiente dock, `commit_evidence` API  
**Extends:** `2026-07-15-ambiente-branch-pr-commit-design.md`  
**Related:** `GitDiffModal` / `CommitList`, `Evidence.Commits`, workspace diff file pagination

## 1. Problem

1. A aba **Commits** do Diff do workspace carrega e renderiza **todos** os commits ahead da base de integração de uma vez. Em branches longas a lista pesa a UI (scroll longo, filtro client-side sobre um array grande).
2. Não há indicação visual de quais commits já estão no remote (`origin` / upstream da feature branch) versus só locais.
3. O painel **Ambiente** não mostra commits recentes nem o status online/local — o usuário precisa abrir o Diff para saber o estado.

## 2. Goals

1. Paginar a lista de commits com **Carregar mais** (mesmo padrão dos arquivos no Diff).
2. Marcar cada commit como **Online** (já pushado no remote da feature branch) ou **Local** (ainda não no remote).
3. No Ambiente, listar os **últimos 3** commits com o mesmo status Online/Local.
4. Reusar um único endpoint/`commit_evidence` para Diff e Ambiente.

## 3. Non-goals

- Paginação numerada ou scroll infinito.
- Filtro server-side de commits (o filter da lista continua só sobre itens já carregados).
- Status “merged na default” / “no PR” como significado de Online (Online = pushado no remote da feature branch).
- Paginar a aba Evidence do issue drawer nesta mudança (pode consumir a API paginada depois; fora do escopo se não for trivial).
- Virtualização de DOM além da paginação por páginas.

## 4. Decision

**Approach:** Paginação no servidor + campo `online` por commit (opção 1 do brainstorm).

| Área | Decisão |
|------|----------|
| Paginação | Cursor/offset + `limit` no `GET .../commit_evidence`, espelhando files do Diff |
| Default page size | `limit=20` (Diff); Ambiente usa `limit=3` |
| Online | SHA é ancestral do tip remoto da feature branch (`@{upstream}` ou `origin/<branch>`) |
| Sem remote da branch | Todos `online: false` |
| UI Diff | Badge Online/Local por linha + botão Carregar mais |
| UI Ambiente | Seção Commits com até 3 itens; clique abre Diff na aba Commits |

## 5. API — `commit_evidence`

### 5.1 List (index)

`GET /api/tracker/v1/projects/:slug/issues/:identifier/commit_evidence`

**Query:**

| Param | Default | Notes |
|-------|---------|--------|
| `limit` | `20` | Cap razoável (ex. max `100`), alinhado a `workspace_diff` files |
| `cursor` | absent | Offset opaco/encoded como nos files do Diff |

**Response shape:**

```json
{
  "commits": [
    {
      "repo": "advising",
      "sha": "...",
      "shortSha": "...",
      "message": "...",
      "author": "...",
      "authoredAt": "...",
      "filesChanged": 2,
      "insertions": 61,
      "deletions": 10,
      "online": true
    }
  ],
  "total": 42,
  "limit": 20,
  "nextCursor": "...",
  "workspace": { "path": "...", "available": true }
}
```

- Ordenação inalterada: `authored_at` descendente, multi-repo flat.
- `nextCursor` é `null` quando não há mais páginas.
- Show (detail por SHA) inalterado; não precisa de `online` no detail para o MVP (pode incluir por consistência).

### 5.2 Semântica de `online`

Para cada repo no workspace:

1. Resolver tip remoto da feature branch: `@{upstream}` se tracking existir; senão `origin/<branch>` se a ref existir.
2. Se tip remoto existir: `online = true` quando o SHA é ancestral desse tip (`merge-base --is-ancestor` ou equivalente).
3. Se tip remoto não existir: `online = false` para todos os commits daquele repo.

A lista continua sendo o range `origin/<default>..HEAD` (ou fallback local). Assim:

- Commits em `@{upstream}..HEAD` → **Local** (`online: false`)
- Commits já no remote tip mas ainda não na default → **Online** (`online: true`)

### 5.3 Implementação backend

- Extender `SymphonyElixir.Evidence.Commits.list/2` para retornar página + `total` + `next_cursor` (ou wrapper no controller que pagina a lista completa se a paginação nativa no `git log` for cara demais no MVP).
- Preferência: após montar a lista ordenada (comportamento atual), aplicar `offset`/`limit` e anexar `online` por commit. Isso reduz payload/UI; custo de `git log` full permanece. Se no futuro o log for o gargalo, paginar no `git log` por repo.
- Controller: aceitar `limit`/`cursor`, serializar camelCase como o restante do tracker API.
- Testes: controller + módulo `Commits` — página 1/2, `next_cursor`, `online` true/false com fixture de repo com/sem upstream.

## 6. UI — Diff modal (`CommitList`)

1. Hook `useIssueCommitEvidence` passa a acumular páginas: `loadMore()` quando `nextCursor` presente; `refetch()` reseta para a primeira página.
2. Botão **Carregar mais** no fim da lista (mesmo copy/padrão de `issue.diff.loadMore` / loading).
3. Cada linha: indicador compacto **Online** / **Local** (badge ou ícone + texto i18n).
4. Filtro client-side só sobre commits já carregados (documentado; sem mudança de expectativa forte).
5. Strings novas em `en` e `pt-BR` (`issue.commits.online`, `issue.commits.local`, reusar `loadMore` se possível).

## 7. UI — Ambiente (`IssueEnvironmentDock`)

Inserir seção **Commits** na ordem estendida do dock Ambiente:

1. Alterações  
2. Área de trabalho local  
3. Branches  
4. Ações (Commit e push / Comparar)  
5. **Commits** (nova) — até 3 itens: mensagem truncada, short SHA, badge Online/Local  
6. PRs vinculados  
7. Fontes  

Comportamento:

- Fetch `commit_evidence?limit=3` quando o dock está aberto.
- Seção omitida se lista vazia (ou empty discreto — preferir omitir).
- Clique no item: abre `GitDiffLauncher` na aba Commits; se trivial, seleciona o commit clicado (prop/`openRequestId` + sha opcional). Se seleção deep-link for complexa demais, abrir só a aba Commits nesta entrega e deixar seleção explícita como follow-up documentado.
- Loading/erro leves, alinhados ao restante do dock.

i18n: `assistant.environment.commits`, `assistant.environment.online`, `assistant.environment.local` (ou chaves compartilhadas com `issue.commits.*`).

## 8. Error handling

| Caso | Comportamento |
|------|----------------|
| Workspace ausente / sem git | `commits: []`, `total: 0`, `nextCursor: null` |
| Sem remote da feature branch | Lista ok; todos `online: false` |
| Cursor inválido | 400 ou página vazia com cursor nil (seguir padrão do Diff files) |
| Falha de fetch no Diff | Estado de erro existente + retry via Atualizar |
| Falha de fetch no Ambiente | Omitir seção ou linha de erro curta; não bloquear o dock |

## 9. Testing

- **Elixir:** `Commits` list pagination + `online` com repos fixture (pushado vs ahead); controller query params.
- **Tracker:** `CommitList` mostra badge e chama `loadMore`; Ambiente renderiza 3 commits e badges; um teste de click/open se deep-link for implementado.
- WSL: um arquivo/filtro de teste por vez; não rodar suite completa.

## 10. Out of scope / follow-ups

- Paginar Evidence tab do drawer.
- Deep-link obrigatório Ambiente → commit selecionado (nice-to-have nesta entrega).
- Otimizar `git log` para não materializar a lista completa no servidor.
