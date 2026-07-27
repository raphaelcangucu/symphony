# Benchmark de landing page multiagente

Este pacote executa o mesmo prompt de landing page por dois caminhos reais do
Symphony:

- sessão interativa;
- issue despachado pelo orquestrador.

A execução padrão usa a matriz focada `dev10x-brand-high`, com 6 células:
sessão e orquestrador para Codex `gpt-5.6-sol` high, Cursor
`cursor-grok-4.5-high` e Claude `claude-opus-5` high. No Cursor, o esforço high
é parte do slug canônico; por isso os campos separados de esforço solicitado e
resolvido permanecem nulos.

As 18 células anteriores continuam definidas para reprodução histórica:

- `providers-default`: sessão e orquestrador com Codex `gpt-5.5` medium,
  Claude `claude-sonnet-5` medium e Cursor `composer-2.5`;
- `providers-advanced`: sessão e orquestrador com Codex `gpt-5.5` high,
  Claude `claude-opus-5` high e Cursor `cursor-grok-4.5-high`;
- `codex-5.6-defaults`: sessão e orquestrador com `gpt-5.6-sol` low,
  `gpt-5.6-terra` medium e `gpt-5.6-luna` medium.

O prompt canônico fica em [`prompt.md`](prompt.md); seu SHA-256 é gravado em
todas as execuções para impedir comparações com instruções diferentes. Cada
célula também valida o agente, o modelo solicitado, o modelo confirmado pelo
provedor e o esforço. O adapter Cursor resolve nomes e identificadores nativos
contra o catálogo vivo e persiste um único slug canônico.

## Contrato

Cada agente deve criar em `site/`:

- React + TypeScript + Vite e CSS próprio;
- scripts `dev`, `build` e `test:e2e`;
- preview compatível com `npm run dev -- --host 0.0.0.0`;
- Playwright abrindo a aplicação real por HTTP;
- runner E2E isolado que inicia e encerra seu próprio preview sem depender da
  sondagem de `webServer` do Playwright;
- execução de build/E2E com allowlist de ambiente, sem repassar tokens aos
  scripts gerados;
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
export SYMPHONY_BENCH_MATRIX=dev10x-brand-high
export SYMPHONY_BENCH_CONCURRENCY=3

npm install
npm run provision
npm run run:brand-high
npm run collect
npm run capture:visuals
```

`npm run provision` usa `dev10x-brand-high` por padrão, mesmo sem a variável
explícita. Para reproduzir uma matriz histórica, defina
`SYMPHONY_BENCH_MATRIX` com o nome dela antes de provisionar. Execute uma matriz
por vez, ou células independentes em paralelo quando houver capacidade. Os
testes unitários do Symphony continuam focados e sequenciais:

```bash
SYMPHONY_BENCH_CONCURRENCY=3 npm run run:default
SYMPHONY_BENCH_CONCURRENCY=3 npm run run:advanced
SYMPHONY_BENCH_CONCURRENCY=3 npm run run:codex-5.6
```

Para repetir apenas uma célula, use
`SYMPHONY_BENCH_RUN_ID=<id> npm run run:cell`.
O runner limita a concorrência a seis células e, se houver falhas, aguarda as
demais células do lote e apresenta um resumo agregado.

Após executar as células, colete build/E2E e gere as capturas visuais
padronizadas:

```bash
npm run collect
npm run capture:visuals
```

O coletor instala dependências com lifecycle scripts desativados e executa
build/E2E com um ambiente sanitizado. O capturador usa `--strictPort`, timeout
por requisição HTTP e continua registrando as demais células caso uma captura
falhe.

## Saídas

O runtime contém:

- `results/<run-id>.json`: resultado bruto de cada fluxo;
- `results/<run-id>-collected.json`: contrato e validação independente;
- `artifacts/<run-id>/attempts/`: vídeo e screenshot da UI real do Symphony;
- `report/comparison.{json,md}`: matriz objetiva;
- `report/visual-comparison.md`: comparação visual detalhada no mesmo viewport;
- `report/screens/`: seis capturas por célula — hero, fluxo, seção de
  evidências, página desktop completa, página mobile completa e aba Evidências
  do Symphony;
- `report/videos/`: WebM, MP4/H.264 e prévia GIF inline por célula.

O manifesto canônico de cada célula registra as cinco capturas do site, os
vídeos WebM e MP4/H.264 e o trace Playwright. A sexta captura demonstra os
mesmos artefatos persistidos e renderizados na aba Evidências do Symphony.

Os artefatos de runtime não são versionados: vídeos e traces podem ser grandes
e podem conter caminhos locais do ambiente de execução.

O trace do fluxo externo do tracker fica desativado porque poderia serializar o
token bearer. Os traces exigidos pelo contrato são produzidos pelos E2Es das
landings em `site/test-results/`, sem credenciais do tracker.
