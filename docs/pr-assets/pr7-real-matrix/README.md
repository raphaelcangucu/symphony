# PR #7 — matriz real incremental no Mac

Esta pasta registra somente células executadas pelo Dev10x Mobile contra o
host Symphony local pareado por E2EE. Não há mock, fallback de provider nem
tarefa-mãe usada como evidência oficial.

| Célula | Caminho | Task | Sessão | Provider resolvido | Resultado |
| --- | --- | --- | ---: | --- | --- |
| `session-codex-vin3` | sessão | `VIN-3` | `#6` | Codex · `gpt-5.6-sol` / low | passed |

## session-codex-vin3

- Fonte: `dev10x-ai/website` em `1fe2e23` (`vin-3-codex-session-matrix`);
- build real: `npm run build` aprovado;
- E2E real no Mac: 2/2 Playwright aprovados em desktop e mobile;
- evidência durável no host: `20260729030532-vin3-codex-session`;
- a tentativa do agente no sandbox não podia abrir localhost; o rerun canônico
  foi feito no host Mac e seu log está preservado, sem mascarar a tentativa.

Artefatos: [manifest](session-codex-vin3/manifest.json),
[proveniência](session-codex-vin3/provenance.json),
[hashes](session-codex-vin3/sha256sums.txt),
[log E2E Mac](session-codex-vin3/artifacts/logs/vin-3-mac-e2e.log),
[screenshot desktop](session-codex-vin3/artifacts/screens/vin-3-desktop.png),
[screenshot mobile](session-codex-vin3/artifacts/screens/vin-3-mobile.png),
[vídeo desktop](session-codex-vin3/artifacts/videos/vin-3-desktop.webm),
[vídeo mobile](session-codex-vin3/artifacts/videos/vin-3-mobile.webm),
[trace desktop](session-codex-vin3/artifacts/traces/vin-3-desktop-trace.zip),
[vídeo do app](session-codex-vin3/artifacts/app/vin-3-session-completed.mp4) e
[screenshot do app](session-codex-vin3/artifacts/app/vin-3-session-completed.png).
