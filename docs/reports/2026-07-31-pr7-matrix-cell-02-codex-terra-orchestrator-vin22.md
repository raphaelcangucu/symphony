# PR #7 — Célula 2 — Codex CLI · GPT-5.6 Terra · High · Orchestrator

Status: **corrected; real site E2E passed** (2026-08-01)

## Escopo

- Task criada pelo App Android: `VIN-22 — C2 Codex Terra High Orchestrator Health`.
- Execução: task-associated orchestrator, sem chat artificial, no Host Symphony real.
- Provider: Codex CLI (`gpt-5.6-terra`, `high`).
- Repositório-alvo: `dev10x-ai/website` (workspace multi-repo; o admin não foi tocado).
- Evidência Android: criação, submissão, início e reconexão da execução foram gravados em `cell-02-codex-terra-orchestrator-android/`.

## Resultado real

O Host aceitou a task e a execução ficou `Live` no App. A causa do bloqueio original foi dupla: o runner E2E tentava abrir um listener próprio em `127.0.0.1:4173`, e o Host injetava o `PORT` como prefixo que não era expandido pelo shell. Corrigi o runner para reutilizar o preview contratado e corrigi o Host para exportar as variáveis do contrato antes do comando.

```text
listen EPERM: operation not permitted 127.0.0.1:4173
```

Após a correção, o preview real ficou `ready` e `in_sync` em `http://127.0.0.1:10000/`, e a validação Playwright contra esse Host passou em desktop e mobile. Não substituí o Host por mock.

## Correções/configuração tentadas

- O projeto recebeu contrato de `dev_server` com `runtime_contract_v1`, faixa de portas `10000–30000` e reclaim habilitado.
- O workspace VIN-22 recebeu `.symphony/devenv.yaml` com preview real do Vite, `--host 127.0.0.1`, `--port "$PORT"`, `--strictPort` e readiness em `/health`.
- `DevServer.Manager` e `DevServer.Instance` passaram a usar `export KEY=value; ...`, permitindo que `$PORT` seja expandido corretamente em macOS, Linux e Windows via shell compatível.
- `scripts/run-e2e.mjs` passou a aceitar `SYMPHONY_PREVIEW_URL`/`PLAYWRIGHT_BASE_URL` com `SYMPHONY_PREVIEW_REUSE=1`, evitando um segundo listener quando o Host já fornece o preview.
- A execução limpa da mesma VIN-22 foi disparada sem criar nova task. O transcript foi pausado após o bootstrap do Chromium do agente reportar uma restrição MachPort específica do sandbox; a mesma linha E2E foi então executada diretamente contra o preview real do Host.

## Validações

- `npm run build`: passou (registrado no manifesto do workspace).
- `git diff --check`: passou.
- `npm run test:e2e -- --grep 'landing|health'`, com `SYMPHONY_PREVIEW_REUSE=1`, `SYMPHONY_PREVIEW_URL=http://127.0.0.1:10000` e `PLAYWRIGHT_BASE_URL=http://127.0.0.1:10000`: **3 passaram (2.1s)**.
- Capturas reais geradas: `site-e2e-20260801/screens/vin-22-health-desktop-full.png` e `vin-22-health-mobile-full.png`; vídeos e traces de cada teste estão no mesmo diretório de evidência.
- App Android: fluxo real de criação e execução gravado; a tela de execução mostrou `Live` e depois os cards de falha do E2E.

## Evidência e próxima ação

Os assets Android, as novas capturas desktop/mobile, vídeos, traces, manifesto, proveniência e hashes estão em `.symphony/evidence/artifacts/cell-02-codex-terra-orchestrator-android/` e serão publicados no [Gist específico da célula](https://gist.github.com/raphaelcangucu/266e892faf5e908cfd83969632f60a6f). A célula permanece pausada para revisão; não avanço para Claude/Cursor nesta etapa.
