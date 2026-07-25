# Avaliação objetiva das landings Dev10x

## Conclusão

O melhor resultado geral foi
**`session-codex-gpt5.6.terra-medium`**, com 97/100. A página cria a identidade
Dev10x mais consistente do lote, usa hierarquia editorial clara, traduz o fluxo
do produto em componentes visuais e mantém a mesma qualidade no mobile.

## Rubric

Só foram pontuadas células com contrato, build, E2E e evidência aprovados.

| Critério | Peso | Evidência usada |
| --- | ---: | --- |
| Cobertura do prompt e copy Dev10x | 20 | conteúdo obrigatório, marca e ausência de Symphony visível |
| Hierarquia visual e coerência | 25 | hero, ritmo, tipografia, cor e identidade entre seções |
| Responsividade e legibilidade | 20 | desktop 1280 px, mobile 390 px e overflow |
| Acessibilidade e semântica | 15 | landmarks, ARIA, foco e movimento reduzido |
| Qualidade técnica e evidências | 20 | build, E2E, profundidade dos testes e artefatos |

## Finalistas

| Posição | Célula | Copy | Visual | Mobile | A11y | Técnica | Total |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | session-codex-gpt5.6.terra-medium | 20 | 25 | 20 | 14 | 18 | **97** |
| 2 | session-codex-gpt5.6.luna-medium | 20 | 24 | 20 | 13 | 18 | **95** |
| 3 | session-codex-gpt5.6.sol-low | 20 | 25 | 18 | 14 | 17 | **94** |
| 4 | session-claude-opus5-high | 20 | 22 | 16 | 15 | 20 | **93** |
| 5 | session-claude-sonnet5-medium | 20 | 21 | 19 | 14 | 18 | **92** |
| 6 | session-cursor-grok4.5-high | 20 | 23 | 18 | 13 | 17 | **91** |

## Leitura dos resultados

- **Terra** venceu pelo equilíbrio: editorial sem parecer decorativo,
  excelente uso de claro/escuro, fluxo legível e adaptação mobile precisa.
- **Luna** teve a composição mais refinada e o melhor ritmo de página, mas
  oferece um pouco menos de densidade semântica que Terra.
- **Sol** foi o mais memorável visualmente e criou os melhores mockups de
  produto; perdeu pontos por densidade e tipografia menor no mobile.
- **Opus** entregou a maior profundidade técnica, 26 usos de ARIA e uma página
  muito completa; a extensão e o texto pequeno reduzem a legibilidade.
- **Sonnet** venceu a matriz padrão por clareza, consistência e boa suíte E2E.
- **Grok** produziu a direção tipográfica mais original do Cursor, mas com
  menos variação de ritmo e menor conforto de leitura nas seções mobile.

Entre os orquestradores, o melhor resultado visual foi
`orchestrator-cursor-grok4.5-high`: boa hierarquia, dados de sessão úteis e
identidade consistente. Ainda assim, os seis primeiros lugares gerais ficaram
com sessões interativas; nesta tarefa criativa, elas aproveitaram melhor os
turnos para refinamento visual.

## Vencedores por recorte

| Recorte | Vencedor |
| --- | --- |
| Geral e GPT‑5.6 | `session-codex-gpt5.6.terra-medium` |
| Providers padrão | `session-claude-sonnet5-medium` |
| Providers avançados | `session-claude-opus5-high` |
| Melhor orquestrador | `orchestrator-cursor-grok4.5-high` |
| Maior ousadia visual | `session-codex-gpt5.6.sol-low` |
| Maior profundidade técnica | `session-claude-opus5-high` |

As imagens e os vídeos usados nesta avaliação estão em
[`visual-comparison.md`](visual-comparison.md).
