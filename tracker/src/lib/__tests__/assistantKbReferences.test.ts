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
});
