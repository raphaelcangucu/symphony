# Benchmark de landing page multiagente

Este pacote executa o mesmo prompt de landing page por dois caminhos reais do
Symphony:

- sessão interativa;
- issue despachado pelo orquestrador.

A matriz usa Codex, Cursor e Claude, totalizando seis células. O prompt
canônico fica em [`prompt.md`](prompt.md); seu SHA-256 é gravado em todas as
execuções para impedir comparações com instruções diferentes.

## Contrato

Cada agente deve criar em `site/`:

- React + TypeScript + Vite e CSS próprio;
- scripts `dev`, `build` e `test:e2e`;
- preview compatível com `npm run dev -- --host 0.0.0.0`;
- Playwright abrindo a aplicação real por HTTP;
- validações de hero, agentes, fluxo, evidências, âncora e mobile;
- screenshot, vídeo e trace.

Uma falha de provedor permanece falha da célula. O benchmark não substitui o
agente e não usa fallback.

## Execução

Use uma instância dedicada do Symphony e um diretório de runtime descartável:

```bash
export SYMPHONY_BENCH_URL=http://127.0.0.1:4010
export SYMPHONY_BENCH_RUNTIME=/caminho/absoluto/para/runtime
export SYMPHONY_BENCH_TOKEN=<mesmo-token-da-instancia-dedicada>

npm install
npm run provision
```

Execute uma célula por vez para limitar CPU e memória:

```bash
for run_id in \
  session-codex session-cursor session-claude \
  orchestrator-codex orchestrator-cursor orchestrator-claude
do
  SYMPHONY_BENCH_RUN_ID="$run_id" npm run run:cell
done
```

Colete build/E2E e gere as capturas visuais padronizadas:

```bash
npm run collect
npm run capture:visuals
```

## Saídas

O runtime contém:

- `results/<run-id>.json`: resultado bruto de cada fluxo;
- `results/<run-id>-collected.json`: contrato e validação independente;
- `artifacts/<run-id>/attempts/`: vídeo e screenshot da UI real do Symphony;
- `report/comparison.{json,md}`: matriz objetiva;
- `report/visual-comparison.md`: heros e páginas completas no mesmo viewport;
- `report/screens/`: capturas visuais padronizadas.

Os artefatos de runtime não são versionados: vídeos e traces podem ser grandes
e podem conter caminhos locais do ambiente de execução.

O trace do fluxo externo do tracker fica desativado porque poderia serializar o
token bearer. Os traces exigidos pelo contrato são produzidos pelos E2Es das
landings em `site/test-results/`, sem credenciais do tracker.
