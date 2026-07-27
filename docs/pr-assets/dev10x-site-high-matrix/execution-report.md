# Relatório de execução

## Ambiente

- base: `origin/main` em
  `293beba84db8a6295d6242b6844510a9eca703cd`;
- Symphony local real em `127.0.0.1:4010`;
- Codex CLI `0.145.0`;
- Cursor Agent `2026.07.23-e383d2b`;
- Claude Code `2.1.220`;
- Node `20.19.6`, npm `10.8.2`;
- Elixir `1.19.5`, Erlang/OTP `28`;
- ffmpeg `6.1.1`.

Os três catálogos vivos confirmaram os modelos antes do dispatch. O Cursor
codifica high no slug `cursor-grok-4.5-high`; Codex e Claude persistiram
`requested_effort=high` e `resolved_effort=high`.

## Execução

As seis células foram disparadas com concorrência limitada a três. O runner
preservou cada tentativa, aguardou o estado terminal do provider e validou a
identidade persistida no tracker. Nenhum resultado usou mock ou fallback.

Depois da geração, cada workspace executou:

1. `npm install --ignore-scripts --no-audit --no-fund`;
2. `npm run build`;
3. `npm run test:e2e`.

Resultado agregado: 18/18 comandos aprovados.

## Falhas reais encontradas

### Janela divergente na sessão Claude

A primeira tentativa de `session-claude-opus5-high-dev10x` continuava ativa no
provider quando o observador de UI atingiu um literal antigo de 25 minutos. A
tentativa bloqueada foi preservada. O contrato passou a usar uma única janela
de settlement de 70 minutos, com headroom determinístico nos limites externos.

Depois que o provider encerrou nativamente, a célula foi retomada no mesmo
thread e workspace, sem reset e sem trocar o modelo. A tentativa canônica
concluiu em 3m37s. Esse tempo representa somente a retomada e não foi usado
como vantagem no ranking.

### Colisão transitória nas portas de captura

Três previews encerraram com `strictPort` porque portas determinísticas ainda
estavam em liberação. O capturador agora:

- aguarda a porta ficar realmente disponível;
- preserva stdout/stderr do preview no erro;
- permite recapturar uma única célula pelo ID;
- mantém as demais capturas na ordem do manifesto;
- calcula o exit status somente sobre a célula pedida no recapture.

As três células afetadas foram apenas recapturadas; nenhum agente foi
redispatchado e nenhum resultado de execução mudou.

### Hardening após revisão independente

O gate de revisão encontrou que a presença dos assets não provava o uso
renderizado, que `collect` podia retornar zero com linhas reprovadas e que um
recapture seletivo sem manifesto completo podia degradar o relatório. Foram
adicionados testes de regressão e os contratos agora:

- exigem logo oficial visível/carregada e uso computado da paleta;
- fazem `collect` retornar erro para qualquer célula incompleta;
- recusam recapture seletivo sem seis registros anteriores válidos;
- publicam mídia, WebMs e traces com manifests relativos verificáveis;
- versionam os fontes gerados usados na avaliação de acessibilidade.

## Proteção do WSL

Não foi executada uma suíte completa pesada do Symphony. A validação ficou
restrita ao benchmark Node, aos builds/E2Es pequenos produzidos em cada
workspace e às auditorias mecânicas de mídia.
