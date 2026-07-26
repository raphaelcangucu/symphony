# Benchmark de landing page multiagente

Este pacote executa o mesmo prompt de landing page por dois caminhos reais do
Symphony:

- sessão interativa;
- issue despachado pelo orquestrador.

A matriz histórica fixa modelo e esforço em 18 células. Para a validação mobile,
há uma matriz adicional de seis células com os defaults atuais dos provedores:

- `providers-current-default`: sessão e orquestrador com Codex
  `gpt-5.6-sol` low, Cursor `auto` e Claude `claude-opus-5` xhigh;

- `providers-default`: sessão e orquestrador com Codex `gpt-5.5` medium,
  Claude `claude-sonnet-5` medium e Cursor `composer-2.5`;
- `providers-advanced`: sessão e orquestrador com Codex `gpt-5.5` high,
  Claude `claude-opus-5` high e Cursor `cursor-grok-4.5-high`;
- `codex-5.6-defaults`: sessão e orquestrador com `gpt-5.6-sol` low,
  `gpt-5.6-terra` medium e `gpt-5.6-luna` medium.

O prompt canônico fica em [`prompt.md`](prompt.md); seu SHA-256 é gravado em
todas as execuções para impedir comparações com instruções diferentes. Cada
célula também valida o agente, o modelo solicitado, o modelo confirmado pelo
provedor e o esforço. O adapter Cursor resolve identificadores selecionáveis
contra o catálogo vivo e preserva a confirmação nativa quando o roteador
`auto` devolve um identificador dinâmico fora desse catálogo. Como o esforço
está codificado no slug do Cursor, os dois campos de esforço permanecem nulos.

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

npm install
npm run provision
```

Execute uma matriz por vez, ou células independentes em paralelo quando houver
capacidade. Os testes unitários do Symphony continuam focados e sequenciais:

```bash
SYMPHONY_BENCH_CONCURRENCY=3 npm run run:default
SYMPHONY_BENCH_CONCURRENCY=3 npm run run:advanced
SYMPHONY_BENCH_CONCURRENCY=3 npm run run:codex-5.6
SYMPHONY_BENCH_CONCURRENCY=1 npm run run:current-default
```

Para repetir apenas uma célula, use
`SYMPHONY_BENCH_RUN_ID=<id> npm run run:cell`.
O runner limita a concorrência a seis células e, se houver falhas, aguarda as
demais células do lote e apresenta um resumo agregado.

Sessão e orquestrador compartilham uma única janela de settlement de 70
minutos. Os limites externos têm cinco minutos adicionais em cada camada
(Playwright, processo e célula) para que falhas ainda tenham tempo de registrar
artefatos e encerrar uma execução remota. Quando uma célula do orquestrador
falha, o runner envia `stop` e aguarda o estado terminal; o backend interrompe
cooperativamente o runner do agente antes do fallback forçado, evitando deixar
o processo do CLI ativo.

Colete build/E2E e gere as capturas visuais padronizadas:

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
- `report/visual-comparison.md`: heros e páginas completas no mesmo viewport;
- `report/screens/`: capturas visuais padronizadas.
- `report/videos/`: WebM, MP4/H.264 e prévia GIF inline por célula.

Os artefatos de runtime não são versionados: vídeos e traces podem ser grandes
e podem conter caminhos locais do ambiente de execução.

O trace do fluxo externo do tracker fica desativado porque poderia serializar o
token bearer. Os traces exigidos pelo contrato são produzidos pelos E2Es das
landings em `site/test-results/`, sem credenciais do tracker.
