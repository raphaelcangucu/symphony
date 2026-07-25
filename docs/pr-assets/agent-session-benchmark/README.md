# Evidências — benchmark multiagente e proveniência de modelos

Este diretório contém os artefatos finais do benchmark da landing page do
Symphony, executado em 25 de julho de 2026.

## Resultado

- 15/15 células concluídas;
- 15/15 contratos de modelo aprovados;
- 45/45 etapas de instalação, build e E2E aprovadas;
- 15/15 runs importados, abertos e renderizados na aba Evidências real;
- 60 screenshots PNG: hero, desktop full-page, mobile full-page e aba
  Evidências por célula;
- 15 vídeos E2E MP4/H.264, além dos WebM e traces mantidos na aba Evidências.

## Matrizes

- providers-default: Codex `gpt-5.5` medium, Claude
  `claude-sonnet-5` medium e Cursor `composer-2.5`;
- providers-advanced: Codex `gpt-5.5` high, Claude `claude-opus-5` high e
  Cursor `cursor-grok-4.5-high`;
- codex-5.6-defaults: `gpt-5.6-sol` low, `gpt-5.6-terra` medium e
  `gpt-5.6-luna` medium.

Cada matriz de providers percorre tanto sessão interativa quanto
orquestrador. A matriz Codex 5.6 compara sessões com os esforços padrão
publicados pelo catálogo local.

## Arquivos

- [`comparison.md`](comparison.md): tabela completa e saídas das 15 células;
- [`comparison.json`](comparison.json): relatório bruto do coletor;
- [`execution-report.md`](execution-report.md): causas, correções e decisões
  de contrato;
- [`visual-comparison.md`](visual-comparison.md): comparação visual e links
  para todos os vídeos;
- [`visuals.json`](visuals.json): manifests e ids dos runs importados;
- [`evidence-audit.md`](evidence-audit.md): dimensões, codecs, traces e
  persistência na aba Evidências;
- `screens/`: 60 capturas PNG;
- `videos/`: 15 walkthroughs E2E em MP4.

Prompt SHA-256:
`f9ea44a4d5952da71a896d5d7623f694bb445f52064f563ecf9a3d81744ca297`

Os vídeos WebM de origem, traces ZIP, relatórios e manifests permanecem nos
runs autenticados da aba Evidências. O PR guarda os MP4 prontos para
reprodução e os screenshots em PNG.
