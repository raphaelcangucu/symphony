# Evidências do benchmark multiagente

Este pacote registra a execução do mesmo prompt de landing page no Symphony
por sessão direta e pelo orquestrador, usando Codex, Cursor e Claude.

- Prompt SHA-256:
  `a081d32f102932dc95e64333aaef7f2c2aa47b1d8834667bc8163cb0809e4b38`
- Matriz: 2 caminhos × 3 provedores
- Execução sequencial para limitar o consumo de recursos no WSL
- Resultado do agente separado da validação independente do código gerado
- Estado confirmado pela thread, execução e provedor reais

## Relatórios

- [Comparação objetiva](comparison.md)
- [Comparação visual](visual-comparison.md)
- [Resultado legível por máquina](comparison.json)
- [Prompt canônico](../../../benchmarks/landing-page-agent-comparison/prompt.md)
- [Instruções para reproduzir](../../../benchmarks/landing-page-agent-comparison/README.md)

## Vídeos das sessões Symphony

As gravações publicadas mantêm toda a linha do tempo, usam MP4/H.264 com
`faststart` e foram aceleradas em 4× para reduzir o tamanho no histórico Git.

- [Sessão Codex — concluída](videos/session-codex-4x.mp4)
- [Sessão Cursor — bloqueada](videos/session-cursor-blocked-4x.mp4)
- [Sessão Claude — concluída](videos/session-claude-4x.mp4)

## Vídeos E2E das landings geradas

Cada MP4 abaixo consolida, em velocidade normal, as gravações produzidas pelos
próprios testes Playwright da respectiva landing.

- [Sessão Codex — 1 E2E aprovado](videos/e2e/e2e-session-codex.mp4)
- [Sessão Claude — 6 E2E aprovados](videos/e2e/e2e-session-claude.mp4)
- [Orquestrador Codex — 2 E2E aprovados](videos/e2e/e2e-orchestrator-codex.mp4)
- [Orquestrador Cursor — 1 E2E falho](videos/e2e/e2e-orchestrator-cursor-failed.mp4)
- [Orquestrador Claude — 6 E2E aprovados](videos/e2e/e2e-orchestrator-claude.mp4)

A sessão direta do Cursor não possui vídeo de página: o contrato ACP falhou
antes que a landing fosse gerada.

## Segurança

O trace externo do tracker permaneceu desativado porque ele poderia serializar
o bearer token. O token foi removido dos artefatos e invalidado ao final. Os
traces exigidos pelo prompt foram produzidos somente pelos E2Es das landings.
