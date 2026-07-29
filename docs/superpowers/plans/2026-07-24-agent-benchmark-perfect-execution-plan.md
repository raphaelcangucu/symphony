# Agent benchmark perfect-execution implementation plan

1. Add a failing Cursor ACP contract test, then stop forwarding native
   `.cursor/mcp.json` entries through ACP.
2. Add failing evidence-import controller tests, then implement a thread-bound,
   server-resolved manifest import endpoint.
3. Add failing benchmark tests for issue-bound session records, 30-turn
   workflow, isolated ports, full-page desktop/mobile images, WebM+MP4
   inventory, canonical manifest staging, and persistence.
4. Implement the benchmark lifecycle and update the canonical prompt.
5. Update the Evidence skill's visual/video contract.
6. Run the narrow Node and Elixir tests sequentially and repair regressions.
7. Start a clean isolated Symphony runtime and provision six issue-bound cells.
8. Run session/orchestrator × Codex/Cursor/Claude sequentially, correcting
   reproducible product or harness failures with focused tests.
9. Build and run the focused generated E2E for each page, then capture and
   persist canonical evidence.
10. Verify all Evidence API records and artifacts, publish reports/PNG/MP4 files
    to the external archive referenced by `docs/pr-assets/README.md`, request
    code review, commit, push, and update PR #6 with immutable links and final
    results.
