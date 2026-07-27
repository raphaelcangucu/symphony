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
| 6 | session-cursor-grok4.5-high-dev10x | 25 | 17 | 14 | 17 | 17 | **90** |

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
  composição, menos detalhes de produto e somente um cenário E2E.

## Indicadores técnicos observados

As contagens abaixo são sinais auxiliares no código gerado, não substitutos da
revisão visual.

| Célula | E2E aprovados | ARIA | Landmarks | `focus` | `reduced-motion` | Media queries |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| session-codex-gpt5.6.sol-high-dev10x | 2 | 28 | 16 | 3 | 1 | 4 |
| session-cursor-grok4.5-high-dev10x | 1 | 11 | 12 | 3 | 1 | 3 |
| session-claude-opus5-high-dev10x | 14 | 31 | 12 | 6 | 1 | 14 |
| orchestrator-codex-gpt5.6.sol-high-dev10x | 1 | 15 | 12 | 3 | 1 | 3 |
| orchestrator-cursor-grok4.5-high-dev10x | 1 | 14 | 7 | 3 | 1 | 9 |
| orchestrator-claude-opus5-high-dev10x | 2 | 24 | 17 | 6 | 8 | 14 |

Veja a evidência usada na
[galeria visual completa](visual-comparison.md).
