# Avaliação objetiva das landings Dev10x

## Rubric

Somente células com proveniência, contrato, marca, build, E2E e evidência
aprovados foram pontuadas.

| Critério | Peso | Evidência |
| --- | ---: | --- |
| Fidelidade à marca Dev10x | 25 | assets e cores canônicos, logo visível e ausência de marca Symphony |
| Qualidade visual | 20 | hero, ritmo, tipografia, componentes e consistência entre seções |
| Arquitetura da informação e copy | 15 | narrativa, conteúdo obrigatório, clareza e CTAs |
| Responsividade e acessibilidade | 20 | desktop 1280 px, mobile 390 px, landmarks, ARIA, foco e movimento reduzido |
| Qualidade técnica e evidências | 20 | build, E2E, profundidade dos testes e artefatos reproduzíveis |

## Ranking

| Posição | Célula | Marca | Visual | IA/copy | Resp./a11y | Técnica | Total |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | session-codex-gpt5.6.sol-high-dev10x | 25 | 20 | 15 | 18 | 19 | **97** |
| 2 | session-claude-opus5-high-dev10x | 25 | 19 | 15 | 17 | 20 | **96** |
| 3 | orchestrator-codex-gpt5.6.sol-high-dev10x | 25 | 19 | 15 | 18 | 18 | **95** |
| 4 | orchestrator-claude-opus5-high-dev10x | 25 | 18 | 14 | 18 | 19 | **94** |
| 5 | orchestrator-cursor-grok4.5-high-dev10x | 25 | 18 | 14 | 18 | 18 | **93** |
| 6 | session-cursor-grok4.5-high-dev10x | 24 | 17 | 14 | 17 | 17 | **89** |

## Leitura do resultado

- **Codex em sessão** apresentou a composição mais completa: hero memorável,
  mockup de produto útil, alternância claro/escuro e CTA final consistente. No
  mobile, a tipografia continua expressiva sem overflow.
- **Opus em sessão** teve a maior profundidade técnica e semântica. Perdeu
  pontos porque a página de 11.317 px no mobile concentra texto menor e exige
  uma leitura mais longa.
- **Codex no orquestrador** ficou próximo do vencedor e produziu o melhor
  painel visual de execução, mas sua validação gerada tem apenas um cenário
  E2E.
- **Opus no orquestrador** foi o resultado mais explícito sobre decisões,
  sessões e evidências; a densidade e a escala menor do texto reduziram o
  impacto visual.
- **Grok no orquestrador** entregou uma landing editorial coerente, compacta e
  responsiva. Faltou a mesma profundidade de acessibilidade e testes dos
  primeiros colocados.
- **Grok em sessão** é limpo e consistente, porém tem menor variedade de
  composição, menos detalhes de produto e somente um cenário E2E. A logo
  oficial carrega corretamente; quatro das cinco cores também aparecem como
  estilo computado, motivo da dedução de um ponto em marca.

## Justificativa auditável por critério

- **Session Codex — 97:** marca 25 pela logo canônica carregada e paleta 5/5
  no [`visuals.json`](visuals.json); visual 20 pelo
  [hero](screens/session-codex-gpt5.6.sol-high-dev10x-hero.png) e ritmo da
  [página completa](screens/session-codex-gpt5.6.sol-high-dev10x-full.png);
  IA/copy 15 pelo
  [fluxo](screens/session-codex-gpt5.6.sol-high-dev10x-flow.png) e seção de
  [evidência](screens/session-codex-gpt5.6.sol-high-dev10x-site-evidence.png);
  resp./a11y 18 pela captura
  [mobile](screens/session-codex-gpt5.6.sol-high-dev10x-mobile-full.png), 28
  usos ARIA e dois E2Es; técnica 19 por build/E2E e Evidence aprovados.
- **Session Opus — 96:** marca 25 pela logo e paleta 5/5; visual 19 e IA/copy
  15 pela narrativa e acabamento da
  [página](screens/session-claude-opus5-high-dev10x-full.png); resp./a11y 17
  porque o mobile chega a 11.317 px e usa texto menor, apesar de 31 ARIA, foco
  explícito e 14 media queries; técnica 20 pelos 14 E2Es aprovados.
- **Orchestrator Codex — 95:** marca 25 e paleta 5/5; visual 19 e IA/copy 15
  pelo painel de agentes no
  [hero](screens/orchestrator-codex-gpt5.6.sol-high-dev10x-hero.png) e fluxo
  conciso; resp./a11y 18 pela adaptação mobile e 15 ARIA; técnica 18 porque a
  validação gerada contém somente um E2E.
- **Orchestrator Opus — 94:** marca 25 e paleta 5/5; visual 18 e IA/copy 14
  pela composição coerente, mas densa; resp./a11y 18 por 24 ARIA, 17
  landmarks e oito regras de movimento reduzido; técnica 19 por dois E2Es e
  Evidence completo.
- **Orchestrator Grok — 93:** marca 25 e paleta 5/5; visual 18 e IA/copy 14
  pela landing compacta; resp./a11y 18 pelo melhor comprimento mobile do grupo
  orquestrado e nove media queries; técnica 18 por um E2E.
- **Session Grok — 89:** marca 24 pela logo oficial carregada e cobertura
  computada 4/5 — o azul permanece visível no raster oficial, mas não é usado
  como estilo CSS; visual 17 e IA/copy 14 pela composição mais simples;
  resp./a11y 17 por 11 ARIA e três media queries; técnica 17 por um E2E.

## Indicadores reproduzíveis

| Célula | E2E aprovados | ARIA | Landmarks | `focus` | `reduced-motion` | Media queries |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| session-codex-gpt5.6.sol-high-dev10x | 2 | 28 | 16 | 3 | 1 | 4 |
| session-cursor-grok4.5-high-dev10x | 1 | 11 | 12 | 3 | 1 | 3 |
| session-claude-opus5-high-dev10x | 14 | 31 | 12 | 6 | 1 | 14 |
| orchestrator-codex-gpt5.6.sol-high-dev10x | 1 | 15 | 12 | 3 | 1 | 3 |
| orchestrator-cursor-grok4.5-high-dev10x | 1 | 14 | 7 | 3 | 1 | 9 |
| orchestrator-claude-opus5-high-dev10x | 2 | 24 | 17 | 6 | 8 | 14 |

Os números foram extraídos dos
[`snapshots de fonte`](sources/README.md), que incluem código, configurações e
testes gerados, com hashes em [`source-sha256.txt`](source-sha256.txt). Os
resultados de build e E2E permanecem no [`comparison.json`](comparison.json).

Veja a evidência usada na
[galeria visual completa](visual-comparison.md).
