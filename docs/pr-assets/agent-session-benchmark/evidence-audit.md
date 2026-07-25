# Auditoria de evidências

## Persistência na aba Evidências

O capturador importou um run final por célula, abriu a rota HTTP real da aba
Evidências e esperou o DOM confirmar duas imagens carregadas e dois vídeos com
metadata. Todas as 18 células retornaram `evidence_tab_verified=true`.

| Célula | Issue | Evidence run | Desktop full-page | Mobile full-page | Mídia |
| --- | --- | --- | ---: | ---: | ---: |
| session-codex-gpt5.5-medium | DEV-1 | `20260725212503-2414403` | 1280 × 4585 | 390 × 5456 | 2 + 2 |
| session-cursor-composer2.5 | DEV-2 | `20260725212511-2428739` | 1280 × 3497 | 390 × 5943 | 2 + 2 |
| session-claude-sonnet5-medium | DEV-3 | `20260725212517-2434563` | 1280 × 3767 | 390 × 5610 | 2 + 2 |
| orchestrator-codex-gpt5.5-medium | DEV-4 | `20260725212523-3631490` | 1280 × 5005 | 390 × 6138 | 2 + 2 |
| orchestrator-cursor-composer2.5 | DEV-5 | `20260725212530-1340356` | 1280 × 3230 | 390 × 5681 | 2 + 2 |
| orchestrator-claude-sonnet5-medium | DEV-6 | `20260725212536-3647490` | 1280 × 3963 | 390 × 7009 | 2 + 2 |
| session-codex-gpt5.5-high | DEV-7 | `20260725212544-3659202` | 1280 × 4654 | 390 × 6793 | 2 + 2 |
| session-cursor-grok4.5-high | DEV-8 | `20260725212550-2476355` | 1280 × 3859 | 390 × 5036 | 2 + 2 |
| session-claude-opus5-high | DEV-9 | `20260725212557-3680706` | 1280 × 7507 | 390 × 11241 | 2 + 2 |
| orchestrator-codex-gpt5.5-high | DEV-10 | `20260725212603-3695426` | 1280 × 3963 | 390 × 7009 | 2 + 2 |
| orchestrator-cursor-grok4.5-high | DEV-11 | `20260725212610-401285` | 1280 × 3906 | 390 × 6819 | 2 + 2 |
| orchestrator-claude-opus5-high | DEV-12 | `20260725212617-1368004` | 1280 × 4033 | 390 × 7071 | 2 + 2 |
| session-codex-gpt5.6.sol-low | DEV-13 | `20260725212623-3727426` | 1280 × 4582 | 390 × 6949 | 2 + 2 |
| orchestrator-codex-gpt5.6.sol-low | DEV-14 | `20260725212629-1387076` | 1280 × 4033 | 390 × 7071 | 2 + 2 |
| session-codex-gpt5.6.terra-medium | DEV-15 | `20260725212635-2531267` | 1280 × 4402 | 390 × 5230 | 2 + 2 |
| orchestrator-codex-gpt5.6.terra-medium | DEV-16 | `20260725212642-2546499` | 1280 × 4033 | 390 × 7071 | 2 + 2 |
| session-codex-gpt5.6.luna-medium | DEV-17 | `20260725212648-408709` | 1280 × 4368 | 390 × 5685 | 2 + 2 |
| orchestrator-codex-gpt5.6.luna-medium | DEV-18 | `20260725212654-412485` | 1280 × 4033 | 390 × 7071 | 2 + 2 |

As 36 capturas full-page, os 18 heros e os 18 screenshots da aba Evidências
foram gerados com movimento reduzido. Não houve página em branco, corte
estrutural ou overflow horizontal observado pelos E2Es.

## Vídeo e trace

Os 18 MP4:

- usam H.264, `yuv420p` e resolução 1280 × 720;
- têm `moov` antes de `mdat` (`faststart`);
- decodificaram integralmente com `ffmpeg -v error`;
- foram derivados do WebM gravado pelo Playwright.

Os 18 traces canônicos passaram em `unzip -t`; nenhum artefato canônico é
symlink. Os MP4 reproduzíveis e suas 18 prévias GIF compatíveis com o Markdown
do GitHub estão em [`videos/`](videos/).

## Validação independente

Cada célula executou instalação sem lifecycle scripts arbitrários, build e a
suíte E2E gerada pelo agente. O coletor registrou 18/18
`contract_passed=true` e 54/54 resultados `passed`, sem repassar credenciais.
