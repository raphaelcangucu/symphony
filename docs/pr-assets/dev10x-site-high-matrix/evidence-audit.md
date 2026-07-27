# Auditoria de evidências

## Aba Evidências

Cada captura importou um run final no Symphony, abriu a rota HTTP real da aba
Evidências e esperou o navegador confirmar cinco screenshots e dois vídeos
renderizados.

| Célula | Issue | Evidence run | Desktop full-page | Mobile full-page | Mídia no card |
| --- | --- | --- | ---: | ---: | ---: |
| session-codex-gpt5.6.sol-high-dev10x | DEV-1 | `20260727172649-342211` | 1280 × 5279 | 390 × 8534 | 5 + 2 |
| session-cursor-grok4.5-high-dev10x | DEV-2 | `20260727173113-911106` | 1280 × 3934 | 390 × 5049 | 5 + 2 |
| session-claude-opus5-high-dev10x | DEV-3 | `20260727172657-897858` | 1280 × 7497 | 390 × 11317 | 5 + 2 |
| orchestrator-codex-gpt5.6.sol-high-dev10x | DEV-4 | `20260727173321-916866` | 1280 × 5277 | 390 × 8675 | 5 + 2 |
| orchestrator-cursor-grok4.5-high-dev10x | DEV-5 | `20260727172704-351747` | 1280 × 3989 | 390 × 5966 | 5 + 2 |
| orchestrator-claude-opus5-high-dev10x | DEV-6 | `20260727173333-925314` | 1280 × 6438 | 390 × 9678 | 5 + 2 |

As 36 imagens publicadas são, para cada célula: hero, fluxo, seção de
evidência, página desktop completa, página mobile completa e confirmação da aba
Evidências.

## Marca

As seis células receberam 11 arquivos canônicos de
`tracker/public/dev10x/`. O coletor recalculou os SHA-256 no workspace final:
66/66 verificações de arquivo aprovadas, sem ausências ou divergências.

## Vídeos

- 6 WebM originais gravados pelo Playwright;
- 6 MP4 H.264, `yuv420p`, 1280 × 720 e `faststart`;
- 6 prévias GIF para renderização inline no GitHub;
- MP4 e WebM integralmente decodificados com ffmpeg;
- duração entre 3,92s e 4,20s;
- hashes preservados em [`media-sha256.txt`](media-sha256.txt).

## Traces e segurança de caminhos

Os seis traces canônicos passaram em `unzip -t`. Não há symlink na mídia
publicada nem nos artefatos canônicos selecionados. Os hashes dos traces estão
em [`trace-sha256.txt`](trace-sha256.txt); os ZIPs permanecem no runtime para
não duplicar aproximadamente 13 MB no PR.

## Validação do harness

- benchmark Node: 66/66 testes aprovados;
- `git diff --check`: aprovado;
- 6/6 contratos de conteúdo e marca;
- 18/18 etapas independentes de validação;
- 6/6 capturas e rotas de Evidence verificadas.
