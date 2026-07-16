# Prefill session title from issue

**Date:** 2026-07-16  
**Status:** approved  
**Primary surface:** `StartIssueSessionDialog` (Nova sessão para issue)  
**Related:**
[`2026-07-15-new-session-modal-design.md`](./2026-07-15-new-session-modal-design.md)
(título opcional na criação),
[`2026-07-16-session-auto-title-design.md`](./2026-07-16-session-auto-title-design.md)
(LLM auto-title após a 1ª troca — fora de escopo aqui)

## 1. Problem

Ao criar uma sessão a partir de uma issue, o modal já conhece
`issue.title` (aparece na descrição), mas o campo **Título da sessão**
abre vazio. O usuário precisa digitar de novo o nome da issue.

## 2. Goals

1. Ao abrir `StartIssueSessionDialog`, pré-preencher o título com o
   título da issue (`issue.title`, trimmed).
2. Manter o campo editável; o usuário pode alterar ou limpar antes de
   iniciar.
3. Cobrir o comportamento com um teste unitário no dialog.

## 3. Non-goals

- Prefill no `SidebarNewSessionFlow` (modal Livre / Projeto) — fora deste
  slice; pode seguir o mesmo padrão depois.
- Incluir o identifier no título (`backend#4086 — …`).
- Mudar o fallback de submit (`issue.sessions.defaultSessionTitle`) quando
  o campo estiver vazio.
- Auto-title via LLM (já coberto por outro spec).

## 4. Decisions

| Tópico | Decisão |
|--------|---------|
| Valor inicial | `issue.title.trim()` |
| Formato | Só o título da issue (sem identifier) |
| Editável | Sim |
| Quando resetar | Mesmo efeito atual de init do dialog (por `issue.identifier` + parent) |
| Escopo | Somente `StartIssueSessionDialog` |

## 5. Implementation

Em `tracker/src/components/sessions/StartIssueSessionDialog.tsx`, no
`useEffect` que inicializa o form quando `open` + `issue` mudam, trocar
`setTitle("")` por `setTitle(issue.title.trim())`.

`ProjectSessionsWorkspace.handleNewSession` já passa
`title: issue?.title ?? issueIdentifier`, então o dialog sempre tem um
string útil.

Se o usuário limpar o campo e submeter, permanece o fallback existente
`title.trim() || t("issue.sessions.defaultSessionTitle")`.

## 6. Testing

Em `StartIssueSessionDialog.test.tsx`:

- Ao renderizar com `open` e um `issue` com título, o input
  “session title” deve ter esse valor.
- Um teste de create existente pode deixar de digitar o título e
  assertar que o payload usa o título da issue, **ou** manter um type
  override e só adicionar o assert de prefill — preferir um assert
  dedicado de prefill para não acoplar demais.

## 7. Out of scope follow-ups

- Quando o usuário seleciona uma issue no `SidebarNewSessionFlow`,
  aplicar o mesmo prefill no título da sessão.
