# Snapshots auditáveis dos sites gerados

Cada diretório preserva o código, configuração, runner seguro e testes usados
na validação final da célula. `node_modules`, `dist`, relatórios temporários e
Git interno foram omitidos. Os assets duplicados de `public/dev10x/` também
foram omitidos porque a fonte canônica permanece em `tracker/public/dev10x/`;
os hashes observados estão em `comparison.json` e `visuals.json`.

Verifique os snapshots a partir do diretório pai:

```bash
sha256sum -c source-sha256.txt
```

As contagens da avaliação usam buscas mecânicas nos snapshots:

```bash
for site in sources/*-dev10x; do
  rg -o 'aria-[a-z-]+=' "$site/src" "$site/index.html" | wc -l
  rg -o '<(header|nav|main|section|article|aside|footer)([ >])' "$site/src" | wc -l
  rg -o 'focus-visible|:focus' "$site/src" | wc -l
  rg -o 'prefers-reduced-motion' "$site/src" | wc -l
  rg -o '@media' "$site/src" | wc -l
done
```

| Célula | E2E | ARIA | Landmarks | Foco | Movimento reduzido | Media queries |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| session-codex-gpt5.6.sol-high-dev10x | 2 | 28 | 16 | 3 | 1 | 4 |
| session-cursor-grok4.5-high-dev10x | 1 | 11 | 12 | 3 | 1 | 3 |
| session-claude-opus5-high-dev10x | 14 | 31 | 12 | 6 | 1 | 14 |
| orchestrator-codex-gpt5.6.sol-high-dev10x | 1 | 15 | 12 | 3 | 1 | 3 |
| orchestrator-cursor-grok4.5-high-dev10x | 1 | 14 | 7 | 3 | 1 | 9 |
| orchestrator-claude-opus5-high-dev10x | 2 | 24 | 17 | 6 | 8 | 14 |
