# Matriz atual — sessão e orquestrador

Execução local real contra um host Symphony, com concorrência `1`, usando o
mesmo prompt canônico em todas as células.

- Prompt SHA-256:
  `21315a3c30282f0813eb486ba8e2b124cd744d3528dd275a32ab75b2f9bf38f5`
- Matriz: `providers-current-default`
- Data: 2026-07-26
- Marca visível dos artefatos: Dev10x

| Caminho | Provider | Solicitado | Resolvido pelo provider | Resultado | Duração da tentativa canônica |
| --- | --- | --- | --- | --- | ---: |
| Sessão | Codex | `gpt-5.6-sol / low` | `gpt-5.6-sol / low` | completed | 9m 1s |
| Sessão | Cursor | `auto` | `auto-smart[optimize_for=balanced]` | completed | 3m 46s |
| Sessão | Claude | `claude-opus-5 / xhigh` | `claude-opus-5 / xhigh` | completed | 11m 59s |
| Orquestrador | Codex | `gpt-5.6-sol / low` | `gpt-5.6-sol / low` | completed | 10m 43s |
| Orquestrador | Cursor | `auto` | `Auto Balance` | completed | 3m 58s |
| Orquestrador | Claude | `claude-opus-5 / xhigh` | `claude-opus-5 / xhigh` | completed | 56m 9s observados entre dispatch e fechamento |

Cada célula produziu uma aplicação React/Vite, executou build e Playwright E2E,
iniciou um preview HTTP real e terminou com correspondência entre o provider
solicitado e o registrado na thread.

## Recuperações observadas

- A primeira sessão Cursor concluiu o trabalho, mas foi bloqueada porque a
  versão anterior descartava o identificador dinâmico devolvido pelo roteador
  `auto`. O backend passou a preservar essa confirmação nativa; a nova
  tentativa completou com proveniência verificável.
- A primeira sessão Claude ultrapassou a janela anterior de 25 minutos. A
  janela de sessão foi alinhada aos 40 minutos já usados pelo orquestrador, e a
  nova tentativa completou.
- Claude no orquestrador exigiu recuperação de um processo órfão. O processo
  obsoleto foi encerrado, o turno canônico retomou o workspace preservado,
  produziu build/E2E/evidências e fechou como `saved`. A coleta final não fez
  redispatch.

Tentativas bloqueadas e seus artefatos foram mantidos no runtime do benchmark
para auditoria; somente as tentativas canônicas concluídas aparecem como
resultado final da tabela.
