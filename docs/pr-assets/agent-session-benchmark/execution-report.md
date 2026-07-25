# Relatório de execução — proveniência e benchmark de modelos

## Resultado executivo

O Symphony agora diferencia, sem aliases duplicados no banco:

- modelo e esforço solicitados pelo usuário;
- modelo e esforço confirmados pelo protocolo nativo do provider.

Esses quatro valores são persistidos em colunas canônicas de
`assistant_threads`, expostos pela API/canal, exibidos no cabeçalho da sessão e
incluídos nos relatórios. A interface mostra confirmação pendente ou
redirecionamento quando o resolvido diverge do solicitado.

O benchmark real concluiu as 15 células, aprovou os 15 contratos de
proveniência e as 45 etapas de validação. Os valores persistidos foram:

| Matriz | Caminho | Agente | Solicitado | Resolvido |
| --- | --- | --- | --- | --- |
| default | sessão | Codex | `gpt-5.5` / medium | `gpt-5.5` / medium |
| default | sessão | Cursor | `composer-2.5` | `composer-2.5` |
| default | sessão | Claude | `claude-sonnet-5` / medium | `claude-sonnet-5` / medium |
| default | orquestrador | Codex | `gpt-5.5` / medium | `gpt-5.5` / medium |
| default | orquestrador | Cursor | `composer-2.5` | `composer-2.5` |
| default | orquestrador | Claude | `claude-sonnet-5` / medium | `claude-sonnet-5` / medium |
| advanced | sessão | Codex | `gpt-5.5` / high | `gpt-5.5` / high |
| advanced | sessão | Cursor | `cursor-grok-4.5-high` | `cursor-grok-4.5-high` |
| advanced | sessão | Claude | `claude-opus-5` / high | `claude-opus-5` / high |
| advanced | orquestrador | Codex | `gpt-5.5` / high | `gpt-5.5` / high |
| advanced | orquestrador | Cursor | `cursor-grok-4.5-high` | `cursor-grok-4.5-high` |
| advanced | orquestrador | Claude | `claude-opus-5` / high | `claude-opus-5` / high |
| Codex 5.6 | sessão | Sol | `gpt-5.6-sol` / low | `gpt-5.6-sol` / low |
| Codex 5.6 | sessão | Terra | `gpt-5.6-terra` / medium | `gpt-5.6-terra` / medium |
| Codex 5.6 | sessão | Luna | `gpt-5.6-luna` / medium | `gpt-5.6-luna` / medium |

No Cursor, `high` já faz parte do slug canônico
`cursor-grok-4.5-high`; por isso `requested_effort` e `resolved_effort`
permanecem nulos. O adapter usa o catálogo vivo para traduzir a confirmação
nativa do ACP para exatamente um slug antes de persistir, evitando representar
a mesma decisão em campos concorrentes.

## Catálogos e CLIs usados

- Codex CLI `0.145.0`; o modo automático atual resolve para
  `gpt-5.6-sol` com esforço `low`;
- Claude Code `2.1.220`; o alias atual `sonnet` resolve
  `claude-sonnet-5` e `opus` resolve `claude-opus-5`;
- Cursor Agent `2026.07.23-e383d2b`; os slugs reais usados foram
  `composer-2.5` e `cursor-grok-4.5-high`.

Os catálogos de Codex e Cursor não usam mais listas estáticas como fallback:
falha de descoberta é retornada explicitamente. O catálogo Claude foi
atualizado para os aliases efetivos da CLI instalada.

## Causas encontradas e correções

1. O Codex enviava o modelo no início da thread, mas usava a chave obsoleta
   `reasoningEffort` no turno. A integração agora envia `effort` e registra
   eventos nativos de atualização de modelo/esforço.
2. Cursor ACP devolvia labels ou ids parametrizados. O adapter agora resolve a
   confirmação contra o catálogo vivo e persiste somente o slug canônico;
   confirmações ausentes, ambíguas ou incompatíveis são erros explícitos.
3. O encerramento de subprocessos deixava descendentes órfãos. Cursor e Claude
   passam a usar grupo de processos, e o terminador envia sinal ao grupo com
   sintaxe POSIX correta.
4. O benchmark aceitava um estado final `completed` mesmo quando havia erro
   registrado. O coletor agora reprova essa combinação, e o E2E lança erro para
   runs bloqueados.
5. Sessões reexecutadas podiam confundir contagem virtualizada do chat com
   ausência de turno novo. O observador usa a mudança durável de `updated_at`
   e a confirmação do modelo, mantendo o DOM como sinal adicional.
6. O validador visual duplicava uma expressão regular antiga e rejeitou os
   novos ids de matriz. A captura passou a reutilizar a função canônica
   `artifactSlug`, coberta por testes.
7. Bancos antigos guardavam modelo em chaves JSON concorrentes. A migration
   preenche somente colunas canônicas ausentes, preserva valores canônicos já
   existentes, aceita somente as chaves legadas top-level como fonte confiável,
   remove também duplicatas de `current_turn`, limpa esforços duplicados de
   threads Cursor e não inventa modelo resolvido.
8. Reativação, fork e troca de thread podiam reter provenance antiga. A
   reativação limpa campos resolvidos, `nil` explícito limpa a solicitação, o
   fork copia apenas a configuração solicitada e o composer de sessão não
   hidrata preferências locais de outra thread.
9. O modelo confirmado em um primeiro turno não era levado ao turno seguinte
   do orquestrador. A sessão avançada agora carrega `resolved_model` e
   `resolved_effort`, impedindo que uma confirmação antiga sobrescreva um
   reroute real.
10. Falhas de descoberta de catálogo podiam desaparecer silenciosamente. O
    bundle retorna indisponibilidade explícita por provider e a UI apresenta o
    erro, sem catálogo parcial tratado como sucesso.

## Robustez operacional

As sessões reais foram paralelizadas por matriz. Testes unitários e de
integração do repositório foram mantidos focados e sequenciais para não
sobrecarregar o WSL. O runner visual usa uma porta isolada por célula, converte
WebM para MP4 com `faststart` e só conclui depois de abrir a rota real da aba
Evidências e observar as imagens e vídeos renderizados.
