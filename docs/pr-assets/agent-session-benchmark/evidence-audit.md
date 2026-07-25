# Auditoria de evidências

## Persistência na aba Evidências

O capturador importou um run final por thread. Todos ficaram com status
`passed`, `ui_change=true`, build `passed`, E2E `passed`, dois screenshots
(desktop/mobile), dois vídeos (WebM/MP4) e um trace.

| Issue | Thread | Evidence run |
| --- | ---: | --- |
| SYM-1 | 1 | `20260725052002-1672` |
| SYM-2 | 2 | `20260725052008-774` |
| SYM-3 | 3 | `20260725052014-1864` |
| SYM-4 | 5 | `20260725052020-1158` |
| SYM-5 | 6 | `20260725052027-2440` |
| SYM-6 | 7 | `20260725052033-2632` |

O servidor deriva projeto, issue e workspace a partir da thread; o cliente não
pode apontar um diretório arbitrário. O manifesto também precisa declarar a
mesma issue da thread. O import rejeita symlinks e traversal, persiste a mesma
leitura validada e retorna o mesmo run em retries idênticos.

Uma auditoria Playwright abriu a aba Evidence real nas seis issues. Cada card
final renderizou dois screenshots e dois vídeos autenticados; os cinco
artefatos referenciados por célula (incluindo o trace) responderam HTTP 200.
Veja a [prova visual da aba](screens/evidence-tab-sym-1.png).

## Screenshots full-page

| Célula | Desktop | Mobile |
| --- | ---: | ---: |
| Sessão · Codex | 1280 × 4940 | 390 × 5340 |
| Sessão · Cursor | 1280 × 5549 | 390 × 6736 |
| Sessão · Claude | 1280 × 5624 | 390 × 8341 |
| Orquestrador · Codex | 1280 × 4856 | 390 × 7780 |
| Orquestrador · Cursor | 1280 × 4275 | 390 × 6638 |
| Orquestrador · Claude | 1280 × 6221 | 390 × 8724 |

As 12 capturas full-page e os seis heros foram inspecionados lado a lado. Não
houve página em branco, corte estrutural ou overflow horizontal.

## Vídeo e trace

Os seis MP4:

- usam vídeo H.264;
- usam pixel format `yuv420p`;
- têm resolução 1280 × 720;
- têm o átomo `moov` antes de `mdat` (`faststart`);
- decodificaram integralmente com `ffmpeg -v error`.

Os seis traces passaram em `unzip -t`. Os WebM de origem e traces ZIP estão
anexados aos runs da aba Evidências; os MP4 reproduzíveis estão em
[`videos/`](videos/).

## Validação independente

O coletor executou somente comandos focados e sequenciais para proteger o WSL:

- `npm install --ignore-scripts --no-audit --no-fund`;
- `npm run build`;
- `npm run test:e2e`.

As seis células retornaram `contract_passed=true` e três resultados
`passed` (instalação, build e E2E), totalizando 17 testes E2E aprovados. Esses
processos receberam apenas a allowlist de ambiente necessária, sem credenciais
dos providers ou do tracker.
