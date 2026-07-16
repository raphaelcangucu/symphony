import { describe, expect, it } from "vitest";

import {
  extractKbDocumentReferencesFromMarkdown,
  findKbDocumentReferenceMatches,
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

  it("extracts file scheme references", () => {
    const markdown =
      "Consultei file:///home/user/back/docs/market/spec.md durante a análise.";

    expect(extractKbDocumentReferencesFromMarkdown(markdown)).toEqual(["market/spec.md"]);
  });

  it("returns the exact token boundaries for each match", () => {
    const markdown = "See docs/a/spec.md and (docs/b/plan.md).";
    const matches = findKbDocumentReferenceMatches(markdown);

    expect(matches.map((match) => match.raw)).toEqual(["docs/a/spec.md", "docs/b/plan.md"]);
    expect(markdown.slice(matches[0]!.start, matches[0]!.end)).toBe("docs/a/spec.md");
    expect(markdown.slice(matches[1]!.start, matches[1]!.end)).toBe("docs/b/plan.md");
  });

  it("ignores fragment and query suffixes when tokenizing", () => {
    const markdown = "Abra docs/market/spec.md#alerts?tab=1 agora.";
    const matches = findKbDocumentReferenceMatches(markdown);

    expect(matches.map((match) => match.raw)).toEqual(["docs/market/spec.md#alerts?tab=1"]);
    expect(extractKbDocumentReferencesFromMarkdown(markdown)).toEqual(["market/spec.md"]);
  });

  it("stays fast on large text without any markdown reference", () => {
    const noReference = "x".repeat(200_000);

    const start = performance.now();
    const references = extractKbDocumentReferencesFromMarkdown(noReference);
    const elapsedMs = performance.now() - start;

    expect(references).toEqual([]);
    expect(elapsedMs).toBeLessThan(250);
  });

  it("stays fast on many long path-like tokens without a markdown suffix", () => {
    const lines: string[] = [];
    for (let index = 0; index < 4000; index += 1) {
      lines.push(
        `/home/raphaelcangucu/code/advising-workspaces/advising/CDE-1131/advising/src/components/VeryLongComponentName${index}/index.jsx`,
      );
      lines.push(
        `http://mtu.localhost:4301/advisor/32555201/go/student_profile/1231632146#alerts-${index}`,
      );
    }
    const haystack = lines.join("\n");

    const start = performance.now();
    const references = extractKbDocumentReferencesFromMarkdown(haystack);
    const elapsedMs = performance.now() - start;

    expect(references).toEqual([]);
    expect(elapsedMs).toBeLessThan(250);
  });

  it("still extracts references embedded in a large tool-output-like blob", () => {
    const filler = "x".repeat(100_000);
    const haystack = `${filler}\nVeja docs/market/spec.md para detalhes.\n${filler}`;

    const start = performance.now();
    const references = extractKbDocumentReferencesFromMarkdown(haystack);
    const elapsedMs = performance.now() - start;

    expect(references).toEqual(["market/spec.md"]);
    expect(elapsedMs).toBeLessThan(250);
  });
});
