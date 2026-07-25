# Evidências — benchmark multiagente

Este diretório contém os artefatos finais do benchmark da landing page do
Symphony, executado em 25 de julho de 2026.

## Escopo

- caminhos reais: sessão direta e orquestrador;
- providers reais: Codex, Cursor e Claude;
- prompt idêntico nas seis células;
- seed Git idêntico e runner E2E comum;
- validação independente, sequencial e focada;
- captura full-page desktop/mobile;
- vídeo E2E MP4 por página;
- persistência dos seis manifests na aba Evidências.

## Arquivos

- [`comparison.md`](comparison.md): resultado, causas e correções;
- [`comparison.json`](comparison.json): relatório bruto do coletor;
- [`visual-comparison.md`](visual-comparison.md): 18 screenshots das páginas e
  6 vídeos;
- [`evidence-audit.md`](evidence-audit.md): dimensões, codecs, traces e ids da
  aba Evidências;
- `screens/`: hero, desktop full-page e mobile full-page por célula, mais a
  prova visual da aba Evidence;
- `videos/`: walkthrough E2E MP4/H.264 por célula.

Prompt SHA-256:
`51119498623b6c5095be4e4ee59517273db6fd345d4e9b8574ae4721c450fc50`

Os vídeos WebM de origem, traces e manifests permanecem na aba Evidências do
runtime. O PR guarda os MP4 prontos para reprodução e os screenshots em PNG.
