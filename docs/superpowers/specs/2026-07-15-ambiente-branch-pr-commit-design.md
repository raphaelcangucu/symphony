# Ambiente: branch, PRs vinculados, commit/push e mensagem AI

**Date:** 2026-07-15  
**Status:** Approved for planning  
**Domain:** Tracker sessions workspace UI + workspace diff APIs  
**Extends:** `2026-07-14-environment-workspace-dock-design.md`  
**Related:** GitDiffModal commit dialog, `WorkspaceCommit`, SideQuery / `CodingAgent.run` one-shot patterns

## 1. Problem

O painel Ambiente (`IssueEnvironmentDock`) mostra alterações e ações, mas:

1. Não exibe a branch local do checkout nem a branch vinculada à issue.
2. Não lista PRs vinculados à issue.
3. O botão **Commit e push** só navega para a aba Sessions — não abre o fluxo de commit existente no `GitDiffModal`.
4. O dialog de commit não tem geração de mensagem (sparkle) nem push a partir da UI.

O usuário precisa ver contexto git/PR no Ambiente e publicar mudanças com o mesmo padrão mental do Source Control (mensagem + sparkle + commit, depois push).

## 2. Goals

1. Mostrar **as duas** branches no Ambiente, cada uma rotulada:
   - **Local** — checkout atual no worktree
   - **Issue** — `issue.branchName` do tracker
2. Listar **todos** os PRs vinculados à issue como chips compactos (`PullRequestLink`).
3. Fazer **Commit e push** abrir o `GitDiffModal` **já no dialog de commit**.
4. No dialog: sparkle que gera mensagem via **agente one-shot sem sessão persistente**, botão **Commit** (API existente) e botão **Push** separado (API nova, sem criar PR).
5. Reusar dados/hooks existentes onde possível; dock self-contained para branch/PR.

## 3. Non-goals

- Criação automática de PR no push.
- Force push / `--force-with-lease` automático.
- Staging parcial (continua `git add -A` no commit).
- Reusar Magic `commit-message` via `IssueDispatch` / run completo com sessão.
- Redesign amplo do Ambiente (Sources, Compare, chrome).
- Push/generate em threads freeform sem issue (fora do dock Ambiente issue-bound).

## 4. Decision

**Approach:** Extender o fluxo do `GitDiffModal` (opção 1).

| Área | Decisão |
|------|----------|
| Dados no dock | Self-contained: dock busca branch local, `branchName` da issue e PRs |
| Commit entry | Ambiente → modal + dialog de commit (não navega para Sessions) |
| Push | Botão separado no dialog; `git push -u origin <branch>`; sem PR |
| Mensagem AI | Endpoint dedicado one-shot (`CodingAgent.run`, sem tools), retorna só texto |

## 5. UI — Ambiente (`IssueEnvironmentDock`)

Ordem do conteúdo:

1. **Alterações** (`+N −N`) — inalterado  
2. **Área de trabalho local** — inalterado  
3. **Branches** (nova)
   - `Local · <checkout>`
   - `Issue · <issue.branchName>`
   - Omitir linha ausente; omitir seção se ambas ausentes  
4. **Ações**
   - **Commit e push** → abre modal no dialog de commit  
   - **Comparar** → abre modal no diff (inalterado)  
5. **PRs vinculados** (nova) — chips `PullRequestLink`; omitir se vazio  
6. **Fontes** — `projectSlug` — inalterado  

i18n: chaves novas sob `assistant.environment.*` (ex.: `localBranch`, `issueBranch`, `linkedPullRequests`) em `en` e `pt-BR`.

## 6. UI — Dialog de commit (`GitDiffModal`)

1. Textarea da mensagem — existente  
2. **Sparkle** no canto do campo
   - Chama generate; preenche textarea  
   - Loading no ícone; toast/erro se falhar; não commita sozinho  
3. **Commit** — `POST .../diff/commit` (existente)  
4. **Push** — separado; habilitado quando houver commits ahead  
   - Erro por repo no dialog; sem force  

Entrada pelo Ambiente: `GitDiffLauncher` ganha prop (ex.: `openCommitDialogRequestId` ou flag em `openRequestId`) para abrir modal **e** dialog de commit.

O botão Commit do toolbar do modal continua abrindo o mesmo dialog.

## 7. Data flow

### Ambiente

| Dado | Fonte |
|------|--------|
| Diff +/- | `useWorkspaceDiffStats` (existente) |
| Branch local | Estender stats hook (ou irmão) para expor `stats[].branch` do `GET .../diff/stats` |
| Branch da issue | Fetch leve da issue / campo `branchName` |
| PRs | `useIssuePullRequests({ projectSlug, identifier })` |

### Commit / generate / push

```
Ambiente "Commit e push"
  → GitDiffLauncher (open + commit dialog)
    → GitDiffModal dialog
         sparkle → POST .../diff/generate-commit-message → set message
         Commit  → POST .../diff/commit                  → WorkspaceCommit
         Push    → POST .../diff/push                    → git push -u
```

## 8. Backend APIs

### Existente

- `POST /projects/:slug/issues/:id/diff/commit` — mensagem obrigatória; `git add -A` + commit  
- `GET .../diff/stats` — inclui `branch` por repo  
- `GET .../issues/:id/pull_requests`

### Novo

#### `POST .../diff/generate-commit-message`

- Resolve workspace da issue  
- Monta prompt com issue + resumo do diff uncommitted (truncado)  
- `CodingAgent.run` one-shot: `dynamic_tools: []`, deny-all executor (padrão SideQuery/Judge)  
- **Não** persiste sessão/thread  
- Resposta: `{ "message": "<commit message text>" }`  
- Erros: workspace ausente, nada para commitar, falha do runner  

#### `POST .../diff/push`

- Para cada repo do workspace com commits ahead (ou branch com upstream pending): `git push -u origin <branch>`  
- Sem force; **sem** `gh pr create`  
- Resposta: lista por repo `{ repo, ok | error }`  
- Falha parcial permitida (alguns repos ok, outros erro)

Opcional simétrico para thread assistant (`.../assistant/threads/:id/diff/...`) só se o modal já commit via thread; prioridade é o path issue.

## 9. Edge cases

| Caso | Comportamento |
|------|----------------|
| Sem mudanças locais | Commit / sparkle desabilitados ou erro claro |
| Sem commits ahead | Push desabilitado |
| Multi-repo | Mesma mensagem em todos dirty; push em todos ahead; falha parcial por repo |
| Branch issue ou local ausente | Omitir só aquela linha |
| Generate falha | Textarea intacta; erro visível |
| Push non-fast-forward | Erro explícito; sem force automático |

## 10. Testing

### Tracker (mirado)

- `IssueEnvironmentDock`: duas branches rotuladas; lista PRs; Commit abre modal no dialog  
- `GitDiffModal`: sparkle preenche mensagem; Push chama API e trata erro  

### Elixir (mirado)

- generate-commit-message com runner mock retorna mensagem  
- push sucesso e falha parcial  
- commit blank rejeitado (já coberto)

WSL: um arquivo/filtro de teste por vez; sem suites amplas.

## 11. Out of scope (reaffirm)

- Auto-PR no push  
- Force push  
- Staging parcial  
- Magic template dispatch com sessão  
- Redesign de Sources / Compare  

## 12. Success criteria

1. Ambiente mostra Local e Issue branches quando disponíveis, e PRs vinculados.  
2. **Commit e push** abre o dialog de commit real (não Sessions).  
3. Sparkle preenche mensagem sem criar sessão de agente.  
4. Commit persiste via API existente; Push publica branches sem abrir PR.  
5. Testes mirados cobrem dock + dialog + endpoints novos.
