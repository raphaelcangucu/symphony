# Decisão

## Direção escolhida

Adotar **`session-codex-gpt5.6.sol-high-dev10x`** como referência principal
para o site Dev10x.

O resultado venceu por equilíbrio, não por um único efeito visual: usa a marca
canônica sem descaracterizá-la, transforma o fluxo tarefa → agente → workspace
→ preview → evidência → revisão em uma narrativa clara, mantém ritmo entre
seções claras e escuras e preserva a hierarquia no viewport de 390 px.

## O que incorporar das demais propostas

- De `session-claude-opus5-high-dev10x`: profundidade de E2E, cobertura de
  acessibilidade e explicação mais completa dos dois modos de execução.
- De `orchestrator-codex-gpt5.6.sol-high-dev10x`: o painel visual de agentes e
  a representação do estado de execução.
- De `orchestrator-cursor-grok4.5-high-dev10x`: concisão editorial e o bloco de
  evidência em quatro categorias.

Esses elementos são referências para a implementação final; a decisão não
propõe combinar automaticamente seis bases de código geradas.

## O que não adotar

- Páginas excessivamente longas ou com texto pequeno para compensar densidade;
- navegação mobile apenas reduzida, sem priorização clara;
- evidência descrita como promessa de marketing em vez de artefato verificável;
- escolha por velocidade isolada. O tempo canônico de uma retomada não é
  comparável a uma execução nova, então duração não participou da nota visual.

As notas e deduções estão justificadas critério por critério em
[`evaluation.md`](evaluation.md). A diferença de um ponto para o Opus pode ser
recalculada usando os snapshots de fonte, o dataset e as imagens versionadas.

## Próximo passo recomendado

Usar a direção vencedora como baseline de design e portar para ela os testes de
acessibilidade/fluxo do Opus antes de qualquer publicação do site.
