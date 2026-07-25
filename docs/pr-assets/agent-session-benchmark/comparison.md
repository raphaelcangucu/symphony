# Comparação de agentes — landing page Symphony

Prompt SHA-256:
`a081d32f102932dc95e64333aaef7f2c2aa47b1d8834667bc8163cb0809e4b38`

| Célula | Symphony | Contrato | Validação independente | Duração observada | Diagnóstico |
| --- | --- | --- | --- | ---: | --- |
| Sessão · Codex | Concluído | Passou | Build + 1 E2E passaram | 21m32s | — |
| Sessão · Cursor | Bloqueado | Falhou | Não executada | 20s | Cursor ACP rejeitou `mcpServers` com `invalid_union` |
| Sessão · Claude | Concluído | Passou | Build + 6 E2E passaram | 11m29s | — |
| Orquestrador · Codex | Thread em erro | Passou | Build + 2 E2E passaram | 29m02s | Limite de turnos; saída gerada permaneceu válida |
| Orquestrador · Cursor | Thread em erro | Passou | Build passou; 1 E2E falhou | 6m29s | Execução abortada; seletor `Codex` ficou ambíguo |
| Orquestrador · Claude | Thread em erro | Passou | Build + 6 E2E passaram | 11m55s | Execução abortada após produzir saída válida |

## Conclusões

- Codex e Claude concluíram corretamente pelo caminho de sessão direta.
- O Cursor direto falhou antes de gerar a landing por incompatibilidade no
  contrato ACP, sem fallback para outro provedor.
- As três execuções orquestradas produziram arquivos, mas suas threads reais
  terminaram em erro. Nenhuma foi promovida artificialmente a sucesso.
- Cinco landings cumpriram o contrato e passaram no build.
- Quatro landings passaram integralmente no E2E, totalizando 15 testes
  aprovados. A landing do Cursor orquestrado expôs um teste com seletor
  ambíguo.
- O mesmo prompt foi comprovado em runtime pela descrição da issue, corpo
  exato do workflow e SHA-256.

## Evidências relacionadas

- [Comparação visual](visual-comparison.md)
- [Sessão Codex em vídeo MP4](videos/session-codex-4x.mp4)
- [Falha Cursor em vídeo MP4](videos/session-cursor-blocked-4x.mp4)
- [Sessão Claude em vídeo MP4](videos/session-claude-4x.mp4)
