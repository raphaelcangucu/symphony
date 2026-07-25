# Comparação de agentes — landing page Symphony

Execução canônica em runtime dedicado, com o mesmo prompt e o mesmo seed para
Codex, Cursor e Claude, tanto em sessão direta quanto pelo orquestrador.

Prompt SHA-256:
`51119498623b6c5095be4e4ee59517273db6fd345d4e9b8574ae4721c450fc50`

## Resultado final

| Célula | Symphony | Provider | Contrato | Build | E2E independente | Evidência | Duração |
| --- | --- | --- | --- | --- | --- | --- | ---: |
| Sessão · Codex | Concluído | correto | passou | passou | 2/2 | persistida | 27m35s |
| Sessão · Cursor | Concluído | correto | passou | passou | 1/1 | persistida | 5m00s |
| Sessão · Claude | Concluído | correto | passou | passou | 7/7 | persistida | 19m07s |
| Orquestrador · Codex | Concluído | correto | passou | passou | 1/1 | persistida | 13m04s |
| Orquestrador · Cursor | Concluído | correto | passou | passou | 1/1 | persistida | 6m19s |
| Orquestrador · Claude | Concluído | correto | passou | passou | 5/5 | persistida | 16m09s |

Resultado agregado: **6/6 células concluídas**, **6/6 contratos aprovados**,
**6/6 builds aprovados** e **17/17 testes E2E aprovados**. As threads
orquestradas fecharam com a execução correspondente em estado `saved`; nenhuma
saída foi promovida artificialmente a sucesso.

## Correções comprovadas pelo rerun

1. **Cursor ACP/MCP:** o Symphony convertia `.cursor/mcp.json` para um formato
   que o ACP atual rejeitava com `invalid_union`. `session/new` e
   `session/load` agora enviam o campo obrigatório `mcpServers: []`; o Cursor
   continua carregando a configuração nativa do workspace como fonte única.
2. **Threads falsamente abortadas:** atividade recente sem o texto
   `Turn completed` era tratada como interrupção mesmo com o worker vivo. A
   heurística foi removida; somente falha/abort explícito prevalece sobre o
   snapshot real. `Resume` agora grava um novo boundary sem apagar o histórico,
   impedindo que uma falha antiga volte a abortar o worker retomado.
3. **Settlement prematuro:** o benchmark encerrava quando a thread **ou** a
   execução ficava terminal. Agora exige ambas terminais e
   `execution_session_id` igual ao id da thread observada. Uma thread fechada
   com execução `aborted`, `failed`, `error` ou `canceled` permanece falha.
4. **Limite e gate:** o workflow passou de 5 para 30 turnos e exige evidência.
5. **Runner no WSL:** o preflight HTTP do `webServer` do Playwright podia
   bloquear antes de iniciar o Vite. O seed agora usa um runner próprio:
   inicia Vite em grupo isolado, sonda com `fetch` abortável, executa Playwright
   e encerra o grupo com segurança. O capturador também usa `--strictPort`,
   timeout por request e registra a falha de uma célula sem abandonar as
   seguintes.
6. **Segredos fora do código gerado:** instalação, build, preview e E2E usam
   uma allowlist de ambiente; tokens do Symphony, OpenAI, Anthropic, Cursor e
   GitHub não são propagados. O `npm install` independente desativa lifecycle
   scripts.
7. **Seed das sessões:** cada sessão direta usa o endpoint oficial de
   provisionamento atômico, com `.symphony/ready`, em vez de clonar manualmente
   dentro do benchmark. Os três workspaces começaram no mesmo seed.
8. **Workspace orquestrado pronto:** `.symphony/ready` podia existir sem os
   repositórios quando não havia override de branch. O provisionador agora
   materializa os repositórios configurados também com o mapa de overrides
   vazio, usando `selected_branch`/`default_branch`; respeita hooks de clone
   existentes e suporta repositório raiz em `workspace_path: "."`.
9. **Aba Evidências endurecida:** o endpoint aceita somente `issue_session` e
   `issue_execution`, usa uma única leitura validada do manifesto, rejeita
   symlinks/traversal, contém slugs no diretório durável e torna retry idempotente.
   O capturador relê o mesmo backend da aba e exige desktop, mobile, WebM,
   MP4/H.264 e trace antes de concluir.

## Evidências finais

| Célula | Desktop full-page | Mobile full-page | Vídeo E2E MP4 |
| --- | --- | --- | --- |
| Sessão · Codex | [PNG](screens/session-codex-full.png) | [PNG](screens/session-codex-mobile-full.png) | [MP4](videos/session-codex-e2e.mp4) |
| Sessão · Cursor | [PNG](screens/session-cursor-full.png) | [PNG](screens/session-cursor-mobile-full.png) | [MP4](videos/session-cursor-e2e.mp4) |
| Sessão · Claude | [PNG](screens/session-claude-full.png) | [PNG](screens/session-claude-mobile-full.png) | [MP4](videos/session-claude-e2e.mp4) |
| Orquestrador · Codex | [PNG](screens/orchestrator-codex-full.png) | [PNG](screens/orchestrator-codex-mobile-full.png) | [MP4](videos/orchestrator-codex-e2e.mp4) |
| Orquestrador · Cursor | [PNG](screens/orchestrator-cursor-full.png) | [PNG](screens/orchestrator-cursor-mobile-full.png) | [MP4](videos/orchestrator-cursor-e2e.mp4) |
| Orquestrador · Claude | [PNG](screens/orchestrator-claude-full.png) | [PNG](screens/orchestrator-claude-mobile-full.png) | [MP4](videos/orchestrator-claude-e2e.mp4) |

- [Comparação visual completa](visual-comparison.md)
- [Auditoria da aba Evidências e dos artefatos](evidence-audit.md)
- [Screenshot da aba Evidence com os artefatos renderizados](screens/evidence-tab-sym-1.png)
- [Relatório JSON completo](comparison.json)
