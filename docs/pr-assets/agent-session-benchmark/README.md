# Evidências — benchmark multiagente Dev10x

Este diretório contém os artefatos finais do benchmark da landing page Dev10x,
executado em 25 de julho de 2026 por sessão interativa e orquestrador.

## Resultado

- 18/18 células concluídas;
- 18/18 contratos de modelo aprovados;
- 54/54 etapas de instalação, build e E2E aprovadas;
- 18/18 runs abertos e renderizados na aba Evidências real;
- 72 screenshots PNG: hero, desktop full-page, mobile full-page e aba
  Evidências por célula;
- 18 vídeos E2E MP4/H.264, com prévias animadas embutidas na comparação visual;
- 18 traces canônicos íntegros.

## Matrizes

- `providers-default`: Codex `gpt-5.5` medium, Claude
  `claude-sonnet-5` medium e Cursor `composer-2.5`;
- `providers-advanced`: Codex `gpt-5.5` high, Claude `claude-opus-5` high e
  Cursor `cursor-grok-4.5-high`;
- `codex-5.6-defaults`: `gpt-5.6-sol` low, `gpt-5.6-terra` medium e
  `gpt-5.6-luna` medium.

Todas as matrizes percorrem sessão e orquestrador. Os arquivos usam a identidade
canônica completa, como `session-cursor-grok4.5-high` e
`orchestrator-codex-gpt5.6.luna-medium`.

## Arquivos

- [`comparison.md`](comparison.md): tabela e saídas das 18 células;
- [`comparison.json`](comparison.json): relatório bruto do coletor;
- [`evaluation.md`](evaluation.md): rubric, ranking e conclusão objetiva;
- [`execution-report.md`](execution-report.md): causas e correções;
- [`visual-comparison.md`](visual-comparison.md): screenshots e players MP4;
- [`visuals.json`](visuals.json): manifests e ids dos runs importados;
- [`evidence-audit.md`](evidence-audit.md): dimensões, codecs e persistência;
- `screens/`: 72 capturas PNG;
- `videos/`: 18 walkthroughs E2E em MP4 e 18 prévias GIF inline.

Prompt SHA-256:
`21315a3c30282f0813eb486ba8e2b124cd744d3528dd275a32ab75b2f9bf38f5`

Os WebM de origem, traces ZIP, relatórios e manifests permanecem nos runs
autenticados da aba Evidências. O PR guarda os MP4 reproduzíveis e screenshots.
