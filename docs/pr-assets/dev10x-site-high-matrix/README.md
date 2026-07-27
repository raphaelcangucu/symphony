# Matriz Dev10x — modelos high

Benchmark real de seis células executado contra um Symphony local, partindo de
`origin/main` em `293beba84db8a6295d6242b6844510a9eca703cd`.

Todas as páginas receberam o mesmo prompt e os mesmos arquivos canônicos de
marca de `tracker/public/dev10x/`. Não houve mock, fallback de provider ou
substituição de modelo na evidência oficial.

## Resultado

- 6/6 execuções concluídas;
- 6/6 confirmações nativas de provider/modelo/esforço;
- 6/6 contratos de conteúdo e marca aprovados;
- 18/18 etapas independentes de instalação, build e E2E aprovadas;
- 36 screenshots PNG;
- 6 vídeos WebM canônicos, 6 MP4 H.264 e 6 prévias GIF;
- 6 traces Playwright íntegros e versionados;
- 6/6 runs reabertos e renderizados na aba Evidências real do Symphony.
- 6 logos oficiais carregados no DOM com o SHA canônico;
- 29/30 usos da paleta observados em estilos computados;
- 6 snapshots de código-fonte para reproduzir a auditoria técnica.

O vencedor foi
**`session-codex-gpt5.6.sol-high-dev10x` (97/100)** pelo melhor equilíbrio
entre identidade Dev10x, hierarquia editorial, responsividade, acessibilidade e
qualidade técnica.

## Relatórios

- [Decisão](decision.md)
- [Rubric, notas e ranking](evaluation.md)
- [Matriz de execução e proveniência](comparison.md)
- [Relatório de execução e falhas reais](execution-report.md)
- [Auditoria de screenshots, vídeos, traces e aba Evidências](evidence-audit.md)
- [Galeria visual completa](visual-comparison.md)
- [Dataset coletado](comparison.json)
- [Manifesto das capturas](visuals.json)
- [Versões e contratos dos providers](provider-versions.json)
- [Hashes da mídia canônica](media-sha256.txt)
- [Hashes dos traces canônicos](trace-sha256.txt)
- [Hashes dos snapshots de fonte](source-sha256.txt)
- [Fontes gerados e metodologia de auditoria](sources/README.md)

## Matriz

| Caminho | Codex | Cursor | Claude |
| --- | --- | --- | --- |
| Sessão | `gpt-5.6-sol` / high | `cursor-grok-4.5-high` | `claude-opus-5` / high |
| Orquestrador | `gpt-5.6-sol` / high | `cursor-grok-4.5-high` | `claude-opus-5` / high |

No Cursor, `high` faz parte do slug canônico do modelo. Por isso os campos de
esforço separado permanecem nulos, sem inventar uma segunda representação da
mesma configuração.
