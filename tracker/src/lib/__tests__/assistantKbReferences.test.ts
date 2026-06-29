import { describe, expect, it } from "vitest";

import {
  extractKbDocumentReferencesFromMarkdown,
  normalizeKbDocumentReference,
} from "@/lib/assistantKbReferences";

describe("assistantKbReferences", () => {
  it("normalizes repository docs paths to KB page paths", () => {
    expect(normalizeKbDocumentReference("docs/market/polymarket-omnibus-spec.md")).toBe(
      "market/polymarket-omnibus-spec.md",
    );
    expect(
      normalizeKbDocumentReference(
        "file:///home/raphaelcangucu/symphony/back/docs/market/polymarket-omnibus-plan.md",
      ),
    ).toBe("market/polymarket-omnibus-plan.md");
  });

  it("rejects unsafe and non-markdown references", () => {
    expect(normalizeKbDocumentReference("https://example.com/docs/market/spec.md")).toBeNull();
    expect(normalizeKbDocumentReference("docs/../secret.md")).toBeNull();
    expect(normalizeKbDocumentReference("docs/market/image.png")).toBeNull();
  });

  it("extracts unique KB markdown references from assistant text", () => {
    const markdown = [
      "Veja [spec](docs/market/polymarket-omnibus-spec.md).",
      "Também citei `docs/market/polymarket-omnibus-plan.md`.",
      "Repetido: docs/market/polymarket-omnibus-spec.md",
    ].join("\n");

    expect(extractKbDocumentReferencesFromMarkdown(markdown)).toEqual([
      "market/polymarket-omnibus-spec.md",
      "market/polymarket-omnibus-plan.md",
    ]);
  });

  it("extracts KB references from colon-described chat summaries", () => {
    const markdown = [
      "Criei e sincronizei a documentação no KB do clouapp/back:",
      "",
      "docs/market/polymarket-omnibus-spec.md: spec do fluxo Polymarket omnibus/pass-through.",
      "docs/market/polymarket-omnibus-plan.md: plano de implementação por fases.",
      "docs/market/README.md: índice atualizado com os dois novos documentos.",
    ].join("\n");

    expect(extractKbDocumentReferencesFromMarkdown(markdown)).toEqual([
      "market/polymarket-omnibus-spec.md",
      "market/polymarket-omnibus-plan.md",
      "market/README.md",
    ]);
  });
});
