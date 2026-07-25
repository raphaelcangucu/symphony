# Comparação de agentes — landing page Dev10x

Prompt SHA-256: `21315a3c30282f0813eb486ba8e2b124cd744d3528dd275a32ab75b2f9bf38f5`

| Célula | Matriz | Caminho | Provedor | Solicitado | Resolvido | Execução | Contrato | Validação | Duração observada | Observação |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| session-codex-gpt5.5-medium | providers-default | session | codex | gpt-5.5 (medium) | gpt-5.5 (medium) | completed | passed | passed (1 E2E) | 12m 1s | — |
| session-cursor-composer2.5 | providers-default | session | cursor | composer-2.5 | composer-2.5 | completed | passed | passed (7 E2E) | 2m 41s | — |
| session-claude-sonnet5-medium | providers-default | session | claude | claude-sonnet-5 (medium) | claude-sonnet-5 (medium) | completed | passed | passed (7 E2E) | 8m 29s | — |
| orchestrator-codex-gpt5.5-medium | providers-default | orchestrator | codex | gpt-5.5 (medium) | gpt-5.5 (medium) | completed | passed | passed (1 E2E) | 8m 12s | — |
| orchestrator-cursor-composer2.5 | providers-default | orchestrator | cursor | composer-2.5 | composer-2.5 | completed | passed | passed (1 E2E) | 2m 37s | — |
| orchestrator-claude-sonnet5-medium | providers-default | orchestrator | claude | claude-sonnet-5 (medium) | claude-sonnet-5 (medium) | completed | passed | passed (6 E2E) | 7m 47s | — |
| session-codex-gpt5.5-high | providers-advanced | session | codex | gpt-5.5 (high) | gpt-5.5 (high) | completed | passed | passed (1 E2E) | 14m 4s | — |
| session-cursor-grok4.5-high | providers-advanced | session | cursor | cursor-grok-4.5-high | cursor-grok-4.5-high | completed | passed | passed (1 E2E) | 4m 32s | — |
| session-claude-opus5-high | providers-advanced | session | claude | claude-opus-5 (high) | claude-opus-5 (high) | completed | passed | passed (6 E2E) | 22m 42s | — |
| orchestrator-codex-gpt5.5-high | providers-advanced | orchestrator | codex | gpt-5.5 (high) | gpt-5.5 (high) | completed | passed | passed (1 E2E) | 8m 14s | — |
| orchestrator-cursor-grok4.5-high | providers-advanced | orchestrator | cursor | cursor-grok-4.5-high | cursor-grok-4.5-high | completed | passed | passed (1 E2E) | 2m 46s | — |
| orchestrator-claude-opus5-high | providers-advanced | orchestrator | claude | claude-opus-5 (high) | claude-opus-5 (high) | completed | passed | passed (1 E2E) | 8m 31s | — |
| session-codex-gpt5.6.sol-low | codex-5.6-defaults | session | codex | gpt-5.6-sol (low) | gpt-5.6-sol (low) | completed | passed | passed (1 E2E) | 10m 3s | — |
| orchestrator-codex-gpt5.6.sol-low | codex-5.6-defaults | orchestrator | codex | gpt-5.6-sol (low) | gpt-5.6-sol (low) | completed | passed | passed (1 E2E) | 4m 56s | — |
| session-codex-gpt5.6.terra-medium | codex-5.6-defaults | session | codex | gpt-5.6-terra (medium) | gpt-5.6-terra (medium) | completed | passed | passed (2 E2E) | 7m 40s | — |
| orchestrator-codex-gpt5.6.terra-medium | codex-5.6-defaults | orchestrator | codex | gpt-5.6-terra (medium) | gpt-5.6-terra (medium) | completed | passed | passed (1 E2E) | 2m 41s | — |
| session-codex-gpt5.6.luna-medium | codex-5.6-defaults | session | codex | gpt-5.6-luna (medium) | gpt-5.6-luna (medium) | completed | passed | passed (1 E2E) | 8m 29s | — |
| orchestrator-codex-gpt5.6.luna-medium | codex-5.6-defaults | orchestrator | codex | gpt-5.6-luna (medium) | gpt-5.6-luna (medium) | completed | passed | passed (1 E2E) | 2m 37s | — |

## Saídas

### session-codex-gpt5.5-medium

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-1__p1/site`
- Arquivos gerados: 39
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/session-codex-gpt5.5-medium/attempts/20260725T202024557Z-4f1b581d-856f-454c-9c9a-580c836a7ca5`
- Tentativas: 1 (canônica: 20260725T202024557Z-4f1b581d-856f-454c-9c9a-580c836a7ca5)
- Preview: http://127.0.0.1:10032/
- Identidade: thread=1, agent=codex, status=active, source=tracker_snapshot
- Modelo solicitado: gpt-5.5 (medium)
- Modelo resolvido: gpt-5.5 (medium)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 5 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### session-cursor-composer2.5

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-2__p1/site`
- Arquivos gerados: 59
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/session-cursor-composer2.5/attempts/20260725T202024558Z-d0280b07-b257-4229-9701-6d679923ba02`
- Tentativas: 1 (canônica: 20260725T202024558Z-d0280b07-b257-4229-9701-6d679923ba02)
- Preview: http://127.0.0.1:10001/
- Identidade: thread=2, agent=cursor, status=active, source=tracker_snapshot
- Modelo solicitado: composer-2.5
- Modelo resolvido: composer-2.5
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 9 screenshots, 8 vídeos, 7 traces
- Erro: nenhum registrado

### session-claude-sonnet5-medium

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-3__p1/site`
- Arquivos gerados: 66
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/session-claude-sonnet5-medium/attempts/20260725T202024562Z-03aa1ce0-3017-4218-bf74-b8dce5035768`
- Tentativas: 1 (canônica: 20260725T202024562Z-03aa1ce0-3017-4218-bf74-b8dce5035768)
- Preview: http://127.0.0.1:10003/
- Identidade: thread=3, agent=claude, status=active, source=tracker_snapshot
- Modelo solicitado: claude-sonnet-5 (medium)
- Modelo resolvido: claude-sonnet-5 (medium)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 11 screenshots, 8 vídeos, 7 traces
- Erro: nenhum registrado

### orchestrator-codex-gpt5.5-medium

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-4/site`
- Arquivos gerados: 15
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/orchestrator-codex-gpt5.5-medium/attempts/20260725T202306899Z-eefbcb48-3c75-48fd-b170-f38e0a02bb68`
- Tentativas: 1 (canônica: 20260725T202306899Z-eefbcb48-3c75-48fd-b170-f38e0a02bb68)
- Preview: http://127.0.0.1:10004/
- Identidade: thread=10, agent=codex, status=closed, source=tracker_snapshot
- Modelo solicitado: gpt-5.5 (medium)
- Modelo resolvido: gpt-5.5 (medium)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 2 screenshots, 1 vídeos, 0 traces
- Erro: nenhum registrado

### orchestrator-cursor-composer2.5

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-5/site`
- Arquivos gerados: 45
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/orchestrator-cursor-composer2.5/attempts/20260725T202855779Z-b79de2f1-03db-478b-a9a1-92580dabe594`
- Tentativas: 1 (canônica: 20260725T202855779Z-b79de2f1-03db-478b-a9a1-92580dabe594)
- Preview: http://127.0.0.1:10024/
- Identidade: thread=11, agent=cursor, status=closed, source=tracker_snapshot
- Modelo solicitado: composer-2.5
- Modelo resolvido: composer-2.5
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### orchestrator-claude-sonnet5-medium

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-6/site`
- Arquivos gerados: 20
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/orchestrator-claude-sonnet5-medium/attempts/20260725T203123569Z-9fbb2718-d12f-4c7f-82f8-cffa29897a8d`
- Tentativas: 1 (canônica: 20260725T203123569Z-9fbb2718-d12f-4c7f-82f8-cffa29897a8d)
- Preview: http://127.0.0.1:10040/
- Identidade: thread=12, agent=claude, status=closed, source=tracker_snapshot
- Modelo solicitado: claude-sonnet-5 (medium)
- Modelo resolvido: claude-sonnet-5 (medium)
- Git: 2 arquivos / 2 linhas alteradas
- Evidências: 8 screenshots, 7 vídeos, 6 traces
- Erro: nenhum registrado

### session-codex-gpt5.5-high

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-7__p1/site`
- Arquivos gerados: 38
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/session-codex-gpt5.5-high/attempts/20260725T203929673Z-928edd3a-bcfd-4393-8618-a8b0e3f13d83`
- Tentativas: 1 (canônica: 20260725T203929673Z-928edd3a-bcfd-4393-8618-a8b0e3f13d83)
- Preview: http://127.0.0.1:10064/
- Identidade: thread=4, agent=codex, status=active, source=tracker_snapshot
- Modelo solicitado: gpt-5.5 (high)
- Modelo resolvido: gpt-5.5 (high)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### session-cursor-grok4.5-high

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-8__p1/site`
- Arquivos gerados: 42
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/session-cursor-grok4.5-high/attempts/20260725T203929674Z-7036ef9d-edcc-4cdb-816b-a44a690f1176`
- Tentativas: 1 (canônica: 20260725T203929674Z-7036ef9d-edcc-4cdb-816b-a44a690f1176)
- Preview: http://127.0.0.1:10048/
- Identidade: thread=5, agent=cursor, status=active, source=tracker_snapshot
- Modelo solicitado: cursor-grok-4.5-high
- Modelo resolvido: cursor-grok-4.5-high
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### session-claude-opus5-high

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-9__p1/site`
- Arquivos gerados: 68
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/session-claude-opus5-high/attempts/20260725T203929674Z-5883dce5-8e3f-4042-a895-0e151d1aaf79`
- Tentativas: 1 (canônica: 20260725T203929674Z-5883dce5-8e3f-4042-a895-0e151d1aaf79)
- Preview: http://127.0.0.1:10080/
- Identidade: thread=6, agent=claude, status=active, source=tracker_snapshot
- Modelo solicitado: claude-opus-5 (high)
- Modelo resolvido: claude-opus-5 (high)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 10 screenshots, 7 vídeos, 6 traces
- Erro: nenhum registrado

### orchestrator-codex-gpt5.5-high

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-10/site`
- Arquivos gerados: 44
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/orchestrator-codex-gpt5.5-high/attempts/20260725T204403580Z-d1f69eee-28da-4740-9a29-627de00781e0`
- Tentativas: 1 (canônica: 20260725T204403580Z-d1f69eee-28da-4740-9a29-627de00781e0)
- Preview: http://127.0.0.1:10056/
- Identidade: thread=13, agent=codex, status=closed, source=tracker_snapshot
- Modelo solicitado: gpt-5.5 (high)
- Modelo resolvido: gpt-5.5 (high)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### orchestrator-cursor-grok4.5-high

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-11/site`
- Arquivos gerados: 44
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/orchestrator-cursor-grok4.5-high/attempts/20260725T205223536Z-db5a2900-615e-4532-8016-dd27f8f018ac`
- Tentativas: 1 (canônica: 20260725T205223536Z-db5a2900-615e-4532-8016-dd27f8f018ac)
- Preview: http://127.0.0.1:10005/
- Identidade: thread=14, agent=cursor, status=closed, source=tracker_snapshot
- Modelo solicitado: cursor-grok-4.5-high
- Modelo resolvido: cursor-grok-4.5-high
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### orchestrator-claude-opus5-high

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-12/site`
- Arquivos gerados: 44
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/orchestrator-claude-opus5-high/attempts/20260725T205335037Z-fc6491de-353a-4789-85f9-1564c9d57194`
- Tentativas: 1 (canônica: 20260725T205335037Z-fc6491de-353a-4789-85f9-1564c9d57194)
- Preview: http://127.0.0.1:10000/
- Identidade: thread=15, agent=claude, status=closed, source=tracker_snapshot
- Modelo solicitado: claude-opus-5 (high)
- Modelo resolvido: claude-opus-5 (high)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### session-codex-gpt5.6.sol-low

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-13__p1/site`
- Arquivos gerados: 41
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/session-codex-gpt5.6.sol-low/attempts/20260725T210223227Z-7ca59d3c-7b31-4944-b73f-75c11e37fd28`
- Tentativas: 1 (canônica: 20260725T210223227Z-7ca59d3c-7b31-4944-b73f-75c11e37fd28)
- Preview: http://127.0.0.1:10112/
- Identidade: thread=7, agent=codex, status=active, source=tracker_snapshot
- Modelo solicitado: gpt-5.6-sol (low)
- Modelo resolvido: gpt-5.6-sol (low)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 5 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### orchestrator-codex-gpt5.6.sol-low

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-14/site`
- Arquivos gerados: 44
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/orchestrator-codex-gpt5.6.sol-low/attempts/20260725T210223229Z-2c3ed896-af2b-4108-90e9-e5dd67697d61`
- Tentativas: 1 (canônica: 20260725T210223229Z-2c3ed896-af2b-4108-90e9-e5dd67697d61)
- Preview: http://127.0.0.1:10006/
- Identidade: thread=16, agent=codex, status=closed, source=tracker_snapshot
- Modelo solicitado: gpt-5.6-sol (low)
- Modelo resolvido: gpt-5.6-sol (low)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### session-codex-gpt5.6.terra-medium

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-15__p1/site`
- Arquivos gerados: 16
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/session-codex-gpt5.6.terra-medium/attempts/20260725T210223227Z-5ba67b61-37cc-4f56-a6ab-3c3c88e04221`
- Tentativas: 1 (canônica: 20260725T210223227Z-5ba67b61-37cc-4f56-a6ab-3c3c88e04221)
- Preview: http://127.0.0.1:10104/
- Identidade: thread=8, agent=codex, status=active, source=tracker_snapshot
- Modelo solicitado: gpt-5.6-terra (medium)
- Modelo resolvido: gpt-5.6-terra (medium)
- Git: 11 arquivos / 2091 linhas alteradas
- Evidências: 6 screenshots, 3 vídeos, 2 traces
- Erro: nenhum registrado

### orchestrator-codex-gpt5.6.terra-medium

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-16/site`
- Arquivos gerados: 44
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/orchestrator-codex-gpt5.6.terra-medium/attempts/20260725T211925243Z-1dda70ec-6743-40cc-b733-b7b0f1a49862`
- Tentativas: 2 (canônica: 20260725T211925243Z-1dda70ec-6743-40cc-b733-b7b0f1a49862)
- Preview: http://127.0.0.1:10016/
- Identidade: thread=19, agent=codex, status=closed, source=tracker_snapshot
- Modelo solicitado: gpt-5.6-terra (medium)
- Modelo resolvido: gpt-5.6-terra (medium)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### session-codex-gpt5.6.luna-medium

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-17__p1/site`
- Arquivos gerados: 38
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/session-codex-gpt5.6.luna-medium/attempts/20260725T211005245Z-fd6987c8-81ff-4f20-bb5e-aab939c88779`
- Tentativas: 1 (canônica: 20260725T211005245Z-fd6987c8-81ff-4f20-bb5e-aab939c88779)
- Preview: http://127.0.0.1:10128/
- Identidade: thread=9, agent=codex, status=active, source=tracker_snapshot
- Modelo solicitado: gpt-5.6-luna (medium)
- Modelo resolvido: gpt-5.6-luna (medium)
- Git: 1 arquivos / 1 linhas alteradas
- Evidências: 5 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### orchestrator-codex-gpt5.6.luna-medium

- Workspace: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/workspaces/dev10x-landing-benchmark/DEV-18/site`
- Arquivos gerados: 44
- Artefatos do fluxo: `/tmp/dev10x-bench-model-provenance-pr6-v3/runtime/artifacts/orchestrator-codex-gpt5.6.luna-medium/attempts/20260725T211228017Z-eeaa50c0-fc2f-425b-9dd5-b97261fa3a22`
- Tentativas: 1 (canônica: 20260725T211228017Z-eeaa50c0-fc2f-425b-9dd5-b97261fa3a22)
- Preview: http://127.0.0.1:10120/
- Identidade: thread=18, agent=codex, status=closed, source=tracker_snapshot
- Modelo solicitado: gpt-5.6-luna (medium)
- Modelo resolvido: gpt-5.6-luna (medium)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

## Revisão visual humana

Avaliar lado a lado hierarquia visual, qualidade da cópia, responsividade e manutenção. O coletor não inventa uma nota estética.
