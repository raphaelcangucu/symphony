# Matriz de execução e proveniência

Prompt SHA-256:
`4a0f1ee52954d36ee1732e9ba375ae538ee838c7920dc809d92adb08daf2d6c2`.

| Célula | Caminho | Solicitado | Resolvido | Resultado | Tentativas | Duração canônica | E2E |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| session-codex-gpt5.6.sol-high-dev10x | sessão | `gpt-5.6-sol` / high | `gpt-5.6-sol` / high | passed | 1 | 15m20s | 2 |
| session-cursor-grok4.5-high-dev10x | sessão | `cursor-grok-4.5-high` | `cursor-grok-4.5-high` | passed | 1 | 4m56s | 1 |
| session-claude-opus5-high-dev10x | sessão | `claude-opus-5` / high | `claude-opus-5` / high | passed | 2 | 3m37s após resume | 14 |
| orchestrator-codex-gpt5.6.sol-high-dev10x | orquestrador | `gpt-5.6-sol` / high | `gpt-5.6-sol` / high | passed | 1 | 12m34s | 1 |
| orchestrator-cursor-grok4.5-high-dev10x | orquestrador | `cursor-grok-4.5-high` | `cursor-grok-4.5-high` | passed | 1 | 5m40s | 1 |
| orchestrator-claude-opus5-high-dev10x | orquestrador | `claude-opus-5` / high | `claude-opus-5` / high | passed | 1 | 18m05s | 2 |

## Contratos compartilhados

- mesmo prompt, seed e manifesto de assets;
- logo colorida Dev10x usada no conteúdo;
- favicon e variantes copiados de `tracker/public/dev10x/`;
- paleta canônica: `#0F172A`, `#7C3AED`, `#2563EB`, `#38BDF8` e
  `#FFFFFF`;
- IDs estáveis para hero, fluxo e evidências;
- instalação sem lifecycle scripts, build e E2E reais;
- captura desktop 1280 × 720 e mobile 390 × 844;
- WebM do Playwright, MP4 H.264, GIF de prévia e trace;
- persistência e reabertura na aba Evidências do Symphony.

O dataset detalhado, incluindo hashes de marca, comandos, saídas, IDs de
tentativa e confirmação nativa dos providers, está em
[`comparison.json`](comparison.json).
