# Assistant Session Shell — Codex-inspired chat layout

**Date:** 2026-07-14  
**Status:** Approved for planning  
**Sandbox:** `/tracker/dev/assistant-session-proposals`  
**Approach:** New `AssistantSessionShell` + shared restyle (not a full Codex rebuild)

## 1. Problem

As superfícies de chat do Tracker (`ProjectAssistantPanel` + wrappers) estão
poluídas visualmente e com **múltiplas barras de rolagem** aninhadas (card da
sessão → painel → feed → outputs de tool). O composer expõe demais chips
(Diff / KB / Yolo / Skills / …). Tipografia de bolhas e markdown está grande
demais para densidade estilo Codex.

Referência: app Codex (feed chat limpo, um scroll, composer enxuto, painel
Environment flutuante).

## 2. Goals

1. Um único scroll no feed; composer fixo fora do scroller.
2. Chrome **borderless** (sem card/sombra/gradiente no container da sessão).
3. Feed estilo **Codex chat** (user bubble à direita; agent solto; meta discreta).
4. Composer **split-minimal** (input limpo; avançados no `⋯`).
5. Painel **Environment floating-dock** com ações por **ícone** (+ label curto).
6. Tipografia menor e consistente via tokens no shell.
7. Aplicar o mesmo shell a **todos** os hosts de chat atuais, incluindo
   `surface=session` e `surface=autonomous`.

## 3. Non-goals

- Rebuild total do runtime (streaming, tools, approvals, yolo).
- Virtualização da lista de mensagens.
- Redesign de KB editor, terminal puro, board, ou sidebar global.
- Trocar o `ProjectHeader` / tab bar de workspaces (permanecem; só o miolo da
  sessão fica borderless).
- Dock Environment em chats sem contexto de workspace/issue (omitir ou só
  Sources/thread).

## 4. Decisão de produto (IDs da sandbox)

| Eixo | ID escolhido |
|------|----------------|
| feed | `codex-chat` |
| scroll | `single-feed` |
| chrome | `borderless` |
| composer | `split-minimal` |
| rightPanel | `floating-dock` |

**Implementação:** abordagem **Shell novo + restyle do feed** (não incremental
puro, não rebuild Codex).

## 5. Escopo — hosts

O shell vale para todo host que renderiza chat via `ProjectAssistantPanel` /
`AssistantComposer`, incluindo:

- Workspaces tabs: `?exec=` com `surface=session` **e** `surface=autonomous`
- `/projects/:slug/assistant` e explore
- Assistente de issue (`/assistant/issue/…`, new-issue)
- `/assistant` global
- Sessão embutida no issue drawer (quando aplicável)

Fora: KB editor, terminal, board.

## 6. Arquitetura

```
AssistantSessionShell
├── optional session toolbar (issue chip, diff, tasks, env toggle)
├── feed scroller (único overflow-y)
│   └── message list (codex-chat + tipografia tokens)
├── dock zone (approvals / questions / resume) — acima do composer
├── AssistantComposer (split-minimal)
└── EnvironmentFloatingDock (absolute; icon actions; optional)
```

### Componentes principais

| Peça | Responsabilidade |
|------|------------------|
| `AssistantSessionShell` | Layout: um scroll, borderless, slots, tokens CSS |
| Feed / bubbles | Restyle Codex chat; tools colapsados por padrão |
| `AssistantComposer` | Overflow `⋯`; chips densos saem da barra principal |
| `EnvironmentFloatingDock` | Overlay direita; Changes / branch / ações com ícone |
| Wrappers (`AssistantSessionTabContent`, etc.) | Remover card/scroll externo; usar shell |

Runtime (`ProjectAssistantPanel` streaming, tools, approvals) permanece; o shell
é fronteira de layout.

### Scroll

- Proibido: `overflow-y` no card externo da sessão + no feed ao mesmo tempo.
- Permitido: scroll interno de tool output **expandido**, menus, e o próprio
  dock Environment se o conteúdo passar da altura.

### Tipografia (tokens no shell)

| Token | Uso | Alvo |
|-------|-----|------|
| `--chat-body` | texto user/agent | ~12.5px / leading ~1.45 |
| `--chat-meta` | Worked for…, chips | ~10.5px |
| `--chat-mono` | comandos / paths | ~10.5px |
| `--chat-title` | toolbar | ~12px |

Substituir o padrão atual de bolhas/markdown em `text-sm` + leading generoso.

## 7. Feed (`codex-chat`)

- User: bubble direita, fundo suave, sem card pesado.
- Assistant: texto à esquerda sem caixa; markdown na escala `--chat-body`.
- Meta: `Worked for…` / status em `--chat-meta`, colapsável.
- Tools: resumo discreto sob o turno; output longo só no expand (não rows
  `RODOU` altas por padrão).

Relação com
[`2026-07-10-assistant-scroll-compact-timeline-design.md`](./2026-07-10-assistant-scroll-compact-timeline-design.md):
preservar follow-tail / compact history / interleaved timeline; este spec
muda **chrome visual e densidade tipográfica**, não a semântica de scroll
follow.

## 8. Composer (`split-minimal`)

- Textarea + placeholder; tipografia `--chat-body`.
- Esquerda: `+` (anexos/context) e `⋯` (overflow).
- No `⋯`: Diff, KB, Yolo, Skills, Autônomo, Mágico e demais toggles densos.
- Direita: model / reasoning compactos + send (+ mic se existir).
- Até 1–2 indicadores discretos de estado ativo fora do menu (ou badge no `⋯`).
- Approvals / questions / resume **acima** do composer, fora do scroller do feed.

## 9. Environment (`floating-dock`)

Quando houver contexto de workspace/issue:

- Changes (+/−), Local/remote, branch.
- **Ações com ícone** (+ label curto; ou só ícone com `title`/`aria-label` se
  espaço apertar): Commit/push, Compare, e correlatas.
- Sources com ícone de repo.
- Toggle na toolbar; default aberto em tabs de issue; fechado em freeform/global
  sem tree.
- Overlay: não desloca o feed; z-index acima do feed, abaixo de modais.
- Sem git: omitir ou só Sources/thread.

## 10. Rollout / validação

1. Extrair shell e plugar em todos os hosts listados (§5).
2. Remover nested scroll/card nos wrappers (`AssistantSessionTabContent`, etc.).
3. Restylar feed + tipografia; composer overflow; dock com ícones.
4. Testes (WSL: um arquivo/filtro por vez):
   - scroll único + composer fixo
   - overflow `⋯` expõe toggles
   - smoke: workspaces `surface=session`, `surface=autonomous`, project
     assistant, issue assistant
5. Manter `/dev/assistant-session-proposals` alinhado aos IDs finais.

## 11. Riscos

- Regressão de auto-scroll / follow-tail ao trocar hierarquia de overflow —
  revalidar contra o spec de 2026-07-10.
- Densidade tipográfica demais em markdown rico — calibrar tokens com preview
  real, não só sandbox.
- Dock overlay cobrindo conteúdo em viewports estreitos — permitir fechar e
  colapsar a label das ações para ícone-only.

## 12. Open questions (resolvidas nesta rodada)

| Pergunta | Decisão |
|----------|---------|
| Só workspaces exec ou todos os chats? | Todos os hosts de chat |
| Incluir `surface=autonomous`? | Sim |
| Ações do Environment | Ícones (+ label curto) |
| Abordagem de código | Shell novo + restyle |
