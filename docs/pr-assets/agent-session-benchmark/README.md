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

## Vídeos

As gravações publicadas mantêm toda a linha do tempo e foram aceleradas em 4×
para reduzir o tamanho no histórico Git.

- [Sessão Codex — concluída](videos/session-codex-4x.webm)
- [Sessão Cursor — bloqueada](videos/session-cursor-blocked-4x.webm)
- [Sessão Claude — concluída](videos/session-claude-4x.webm)

## Segurança

O trace externo do tracker permaneceu desativado porque ele poderia serializar
o bearer token. O token foi removido dos artefatos e invalidado ao final. Os
traces exigidos pelo prompt foram produzidos somente pelos E2Es das landings.
