# Comparação de agentes — landing page Symphony

Prompt SHA-256: `f9ea44a4d5952da71a896d5d7623f694bb445f52064f563ecf9a3d81744ca297`

| Célula | Matriz | Caminho | Provedor | Solicitado | Resolvido | Symphony | Contrato | Validação | Duração observada | Observação |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| providers-default-session-codex | providers-default | session | codex | gpt-5.5 (medium) | gpt-5.5 (medium) | completed | passed | passed (1 E2E) | 10m 40s | — |
| providers-default-session-cursor | providers-default | session | cursor | composer-2.5 | composer-2.5 | completed | passed | passed (5 E2E) | 1m 41s | — |
| providers-default-session-claude | providers-default | session | claude | claude-sonnet-5 (medium) | claude-sonnet-5 (medium) | completed | passed | passed (10 E2E) | 9m 48s | — |
| providers-default-orchestrator-codex | providers-default | orchestrator | codex | gpt-5.5 (medium) | gpt-5.5 (medium) | completed | passed | passed (1 E2E) | 7m 37s | — |
| providers-default-orchestrator-cursor | providers-default | orchestrator | cursor | composer-2.5 | composer-2.5 | completed | passed | passed (1 E2E) | 2m 24s | — |
| providers-default-orchestrator-claude | providers-default | orchestrator | claude | claude-sonnet-5 (medium) | claude-sonnet-5 (medium) | completed | passed | passed (1 E2E) | 2m 47s | — |
| providers-advanced-session-codex | providers-advanced | session | codex | gpt-5.5 (high) | gpt-5.5 (high) | completed | passed | passed (2 E2E) | 14m 5s | — |
| providers-advanced-session-cursor | providers-advanced | session | cursor | cursor-grok-4.5-high | cursor-grok-4.5-high | completed | passed | passed (1 E2E) | 1m 37s | — |
| providers-advanced-session-claude | providers-advanced | session | claude | claude-opus-5 (high) | claude-opus-5 (high) | completed | passed | passed (8 E2E) | 21m 37s | — |
| providers-advanced-orchestrator-codex | providers-advanced | orchestrator | codex | gpt-5.5 (high) | gpt-5.5 (high) | completed | passed | passed (1 E2E) | 6m 32s | — |
| providers-advanced-orchestrator-cursor | providers-advanced | orchestrator | cursor | cursor-grok-4.5-high | cursor-grok-4.5-high | completed | passed | passed (1 E2E) | 57s | — |
| providers-advanced-orchestrator-claude | providers-advanced | orchestrator | claude | claude-opus-5 (high) | claude-opus-5 (high) | completed | passed | passed (1 E2E) | 42m 36s | — |
| codex-5.6-defaults-session-sol | codex-5.6-defaults | session | codex | gpt-5.6-sol (low) | gpt-5.6-sol (low) | completed | passed | passed (1 E2E) | 9m 32s | — |
| codex-5.6-defaults-session-terra | codex-5.6-defaults | session | codex | gpt-5.6-terra (medium) | gpt-5.6-terra (medium) | completed | passed | passed (2 E2E) | 34m 37s | — |
| codex-5.6-defaults-session-luna | codex-5.6-defaults | session | codex | gpt-5.6-luna (medium) | gpt-5.6-luna (medium) | completed | passed | passed (4 E2E) | 34m 12s | — |

## Saídas

### providers-default-session-codex

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-1__p1/site`
- Arquivos gerados: 38
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-default-session-codex/attempts/20260725T161157791Z-5730f273-bf14-4d61-b076-23d185652029`
- Tentativas: 1 (canônica: 20260725T161157791Z-5730f273-bf14-4d61-b076-23d185652029)
- Preview: http://127.0.0.1:10000/
- Identidade: thread=1, agent=codex, status=active, source=tracker_snapshot
- Modelo solicitado: gpt-5.5 (medium)
- Modelo resolvido: gpt-5.5 (medium)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 5 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### providers-default-session-cursor

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-2__p1/site`
- Arquivos gerados: 58
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-default-session-cursor/attempts/20260725T192211953Z-aeae40d2-5b05-48db-8fa2-c7045e6f6bd3`
- Tentativas: 2 (canônica: 20260725T192211953Z-aeae40d2-5b05-48db-8fa2-c7045e6f6bd3)
- Preview: http://127.0.0.1:10016/
- Identidade: thread=2, agent=cursor, status=active, source=tracker_snapshot
- Modelo solicitado: composer-2.5
- Modelo resolvido: composer-2.5
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 7 screenshots, 6 vídeos, 5 traces
- Erro: nenhum registrado

### providers-default-session-claude

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-3__p1/site`
- Arquivos gerados: 78
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-default-session-claude/attempts/20260725T163541009Z-a03a8f15-d512-450a-af16-9607f9dd1da0`
- Tentativas: 1 (canônica: 20260725T163541009Z-a03a8f15-d512-450a-af16-9607f9dd1da0)
- Preview: http://127.0.0.1:10016/
- Identidade: thread=3, agent=claude, status=active, source=tracker_snapshot
- Modelo solicitado: claude-sonnet-5 (medium)
- Modelo resolvido: claude-sonnet-5 (medium)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 12 screenshots, 11 vídeos, 10 traces
- Erro: nenhum registrado

### providers-default-orchestrator-codex

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-4/site`
- Arquivos gerados: 39
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-default-orchestrator-codex/attempts/20260725T164530112Z-fbf5a6da-7c6a-4275-b851-d10894b74eb9`
- Tentativas: 1 (canônica: 20260725T164530112Z-fbf5a6da-7c6a-4275-b851-d10894b74eb9)
- Preview: http://127.0.0.1:10001/
- Identidade: thread=10, agent=codex, status=closed, source=tracker_snapshot
- Modelo solicitado: gpt-5.5 (medium)
- Modelo resolvido: gpt-5.5 (medium)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### providers-default-orchestrator-cursor

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-5/site`
- Arquivos gerados: 39
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-default-orchestrator-cursor/attempts/20260725T192212005Z-3637f179-0bb7-4441-b3a6-915348e43c8b`
- Tentativas: 2 (canônica: 20260725T192212005Z-3637f179-0bb7-4441-b3a6-915348e43c8b)
- Preview: http://127.0.0.1:10024/
- Identidade: thread=18, agent=cursor, status=closed, source=tracker_snapshot
- Modelo solicitado: composer-2.5
- Modelo resolvido: composer-2.5
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### providers-default-orchestrator-claude

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-6/site`
- Arquivos gerados: 39
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-default-orchestrator-claude/attempts/20260725T165436000Z-cf7de322-40cf-4acb-aa15-f6950ef0b0a5`
- Tentativas: 1 (canônica: 20260725T165436000Z-cf7de322-40cf-4acb-aa15-f6950ef0b0a5)
- Preview: http://127.0.0.1:10040/
- Identidade: thread=12, agent=claude, status=closed, source=tracker_snapshot
- Modelo solicitado: claude-sonnet-5 (medium)
- Modelo resolvido: claude-sonnet-5 (medium)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### providers-advanced-session-codex

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-7__p1/site`
- Arquivos gerados: 40
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-advanced-session-codex/attempts/20260725T165912884Z-f9ca83f9-e57c-4319-8302-78345a33bffe`
- Tentativas: 1 (canônica: 20260725T165912884Z-f9ca83f9-e57c-4319-8302-78345a33bffe)
- Preview: http://127.0.0.1:10000/
- Identidade: thread=4, agent=codex, status=active, source=tracker_snapshot
- Modelo solicitado: gpt-5.5 (high)
- Modelo resolvido: gpt-5.5 (high)
- Git: 10 arquivos / 2982 linhas alteradas
- Evidências: 4 screenshots, 3 vídeos, 2 traces
- Erro: nenhum registrado

### providers-advanced-session-cursor

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-8__p1/site`
- Arquivos gerados: 41
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-advanced-session-cursor/attempts/20260725T192211975Z-1055e439-6bc2-4b7b-a825-1ee908be7162`
- Tentativas: 4 (canônica: 20260725T192211975Z-1055e439-6bc2-4b7b-a825-1ee908be7162)
- Preview: http://127.0.0.1:10008/
- Identidade: thread=5, agent=cursor, status=active, source=tracker_snapshot
- Modelo solicitado: cursor-grok-4.5-high
- Modelo resolvido: cursor-grok-4.5-high
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 5 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### providers-advanced-session-claude

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-9__p1/site`
- Arquivos gerados: 71
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-advanced-session-claude/attempts/20260725T171646061Z-659188a0-843a-45b4-a8d4-05e156d5abe7`
- Tentativas: 1 (canônica: 20260725T171646061Z-659188a0-843a-45b4-a8d4-05e156d5abe7)
- Preview: http://127.0.0.1:10016/
- Identidade: thread=6, agent=claude, status=active, source=tracker_snapshot
- Modelo solicitado: claude-opus-5 (high)
- Modelo resolvido: claude-opus-5 (high)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 12 screenshots, 9 vídeos, 8 traces
- Erro: nenhum registrado

### providers-advanced-orchestrator-codex

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-10/site`
- Arquivos gerados: 39
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-advanced-orchestrator-codex/attempts/20260725T173824362Z-cd39b870-992c-4966-bb6d-ab2a8a5c6d56`
- Tentativas: 1 (canônica: 20260725T173824362Z-cd39b870-992c-4966-bb6d-ab2a8a5c6d56)
- Preview: http://127.0.0.1:10002/
- Identidade: thread=13, agent=codex, status=closed, source=tracker_snapshot
- Modelo solicitado: gpt-5.5 (high)
- Modelo resolvido: gpt-5.5 (high)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### providers-advanced-orchestrator-cursor

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-11/site`
- Arquivos gerados: 39
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-advanced-orchestrator-cursor/attempts/20260725T192212010Z-88e7b9e9-f09c-4d19-af96-c13a8002bab4`
- Tentativas: 3 (canônica: 20260725T192212010Z-88e7b9e9-f09c-4d19-af96-c13a8002bab4)
- Preview: http://127.0.0.1:10000/
- Identidade: thread=17, agent=cursor, status=closed, source=tracker_snapshot
- Modelo solicitado: cursor-grok-4.5-high
- Modelo resolvido: cursor-grok-4.5-high
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### providers-advanced-orchestrator-claude

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-12/site`
- Arquivos gerados: 39
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/providers-advanced-orchestrator-claude/attempts/20260725T183754214Z-58c7ba31-6a82-463e-8258-39dd29c71cf7`
- Tentativas: 2 (canônica: 20260725T183754214Z-58c7ba31-6a82-463e-8258-39dd29c71cf7)
- Preview: http://127.0.0.1:10017/
- Identidade: thread=16, agent=claude, status=closed, source=tracker_snapshot
- Modelo solicitado: claude-opus-5 (high)
- Modelo resolvido: claude-opus-5 (high)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 3 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### codex-5.6-defaults-session-sol

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-13__p1/site`
- Arquivos gerados: 39
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/codex-5.6-defaults-session-sol/attempts/20260725T183048865Z-0c5de4cc-b836-4fc4-8cbf-80cdc1ba6119`
- Tentativas: 2 (canônica: 20260725T183048865Z-0c5de4cc-b836-4fc4-8cbf-80cdc1ba6119)
- Preview: http://127.0.0.1:10018/
- Identidade: thread=7, agent=codex, status=active, source=tracker_snapshot
- Modelo solicitado: gpt-5.6-sol (low)
- Modelo resolvido: gpt-5.6-sol (low)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 5 screenshots, 2 vídeos, 1 traces
- Erro: nenhum registrado

### codex-5.6-defaults-session-terra

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-14__p1/site`
- Arquivos gerados: 41
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/codex-5.6-defaults-session-terra/attempts/20260725T175432843Z-d0577e50-6917-4eb9-adb9-4b966ef43413`
- Tentativas: 1 (canônica: 20260725T175432843Z-d0577e50-6917-4eb9-adb9-4b966ef43413)
- Preview: http://127.0.0.1:10032/
- Identidade: thread=8, agent=codex, status=active, source=tracker_snapshot
- Modelo solicitado: gpt-5.6-terra (medium)
- Modelo resolvido: gpt-5.6-terra (medium)
- Git: 11 arquivos / 1565 linhas alteradas
- Evidências: 4 screenshots, 3 vídeos, 2 traces
- Erro: nenhum registrado

### codex-5.6-defaults-session-luna

- Workspace: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/workspaces/symphony-landing-benchmark/SYM-15__p1/site`
- Arquivos gerados: 46
- Artefatos Symphony: `/tmp/symphony-bench-model-provenance-pr6-v2/runtime/artifacts/codex-5.6-defaults-session-luna/attempts/20260725T175432833Z-c5e29205-5279-4f0f-9d9b-b7089bda93dc`
- Tentativas: 1 (canônica: 20260725T175432833Z-c5e29205-5279-4f0f-9d9b-b7089bda93dc)
- Preview: http://127.0.0.1:10016/
- Identidade: thread=9, agent=codex, status=active, source=tracker_snapshot
- Modelo solicitado: gpt-5.6-luna (medium)
- Modelo resolvido: gpt-5.6-luna (medium)
- Git: 0 arquivos / 0 linhas alteradas
- Evidências: 6 screenshots, 5 vídeos, 4 traces
- Erro: nenhum registrado

## Revisão visual humana

Avaliar lado a lado hierarquia visual, qualidade da cópia, responsividade e manutenção. O coletor não inventa uma nota estética.
