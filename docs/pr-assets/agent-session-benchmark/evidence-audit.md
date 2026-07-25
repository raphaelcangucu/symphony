# Auditoria de evidências

## Persistência na aba Evidências

O capturador importou um run final por célula, navegou para a rota HTTP real da
aba Evidências da issue e esperou o DOM confirmar duas imagens carregadas e
dois vídeos com metadata. Só então gravou o screenshot full-page da própria
aba. Os 15 retornaram `evidence_tab_verified=true`, rota observada, screenshot
da aba e contagens `2 + 2`.

| Célula | Issue | Evidence run | Desktop full-page | Mobile full-page | Mídia renderizada |
| --- | --- | --- | ---: | ---: | ---: |
| providers-default-session-codex | SYM-1 | `20260725192722-189826` | 1280 × 4543 | 390 × 6603 | 2 + 2 |
| providers-default-session-cursor | SYM-2 | `20260725192729-194754` | 1280 × 4097 | 390 × 7185 | 2 + 2 |
| providers-default-session-claude | SYM-3 | `20260725192738-200130` | 1280 × 3747 | 390 × 5680 | 2 + 2 |
| providers-default-orchestrator-codex | SYM-4 | `20260725192746-96004` | 1280 × 3976 | 390 × 5461 | 2 + 2 |
| providers-default-orchestrator-cursor | SYM-5 | `20260725192753-214466` | 1280 × 3976 | 390 × 5461 | 2 + 2 |
| providers-default-orchestrator-claude | SYM-6 | `20260725192801-156483` | 1280 × 3976 | 390 × 5461 | 2 + 2 |
| providers-advanced-session-codex | SYM-7 | `20260725192809-232898` | 1280 × 4389 | 390 × 6754 | 2 + 2 |
| providers-advanced-session-cursor | SYM-8 | `20260725192816-238146` | 1280 × 3729 | 390 × 5020 | 2 + 2 |
| providers-advanced-session-claude | SYM-9 | `20260725192823-109637` | 1280 × 6465 | 390 × 9618 | 2 + 2 |
| providers-advanced-orchestrator-codex | SYM-10 | `20260725192830-186051` | 1280 × 4030 | 390 × 5515 | 2 + 2 |
| providers-advanced-orchestrator-cursor | SYM-11 | `20260725192837-195011` | 1280 × 3620 | 390 × 4979 | 2 + 2 |
| providers-advanced-orchestrator-claude | SYM-12 | `20260725192845-271042` | 1280 × 3796 | 390 × 6073 | 2 + 2 |
| codex-5.6-defaults-session-sol | SYM-13 | `20260725192853-276930` | 1280 × 4769 | 390 × 7916 | 2 + 2 |
| codex-5.6-defaults-session-terra | SYM-14 | `20260725192902-287106` | 1280 × 4567 | 390 × 5625 | 2 + 2 |
| codex-5.6-defaults-session-luna | SYM-15 | `20260725192909-298562` | 1280 × 4430 | 390 × 5961 | 2 + 2 |

As 30 capturas full-page das landings, os 15 heros e os 15 screenshots
full-page da aba Evidências foram gerados com movimento reduzido e
inspecionados. Não houve página em branco, corte estrutural ou overflow
horizontal.

## Vídeo e trace

Os 15 MP4:

- usam vídeo H.264, pixel format `yuv420p` e resolução 1280 × 720;
- têm o átomo `moov` antes de `mdat` (`faststart`);
- decodificaram integralmente com `ffmpeg -v error`;
- foram derivados do WebM gravado pelo Playwright.

Os 15 traces passaram em `unzip -t`. WebM e traces ZIP estão anexados aos runs
da aba Evidências; os MP4 reproduzíveis estão em [`videos/`](videos/).

## Validação independente

Cada célula executou uma allowlist sequencial e focada no projeto gerado:

- instalação de dependências sem scripts arbitrários;
- build;
- suíte E2E produzida pelo agente.

O coletor registrou 15/15 `contract_passed=true` e 45/45 resultados `passed`.
Esses subprocessos não receberam credenciais dos providers ou do tracker.
