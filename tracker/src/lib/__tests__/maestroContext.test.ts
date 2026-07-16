import { describe, expect, it } from "vitest";

import { maestroContextKey, resolveMaestroContext } from "@/lib/maestroContext";

describe("resolveMaestroContext", () => {
  it("returns home on / and /projects", () => {
    expect(resolveMaestroContext("/")).toEqual({ kind: "home", surface: "home" });
    expect(resolveMaestroContext("/projects")).toEqual({ kind: "home", surface: "home" });
  });

  it("returns home observability on /observability", () => {
    expect(resolveMaestroContext("/observability")).toEqual({
      kind: "home",
      surface: "observability",
    });
  });

  it("returns project on board/list without an open issue", () => {
    expect(resolveMaestroContext("/projects/acme/board")).toEqual({
      kind: "project",
      projectSlug: "acme",
      view: "board",
    });
    expect(resolveMaestroContext("/projects/acme/list")).toEqual({
      kind: "project",
      projectSlug: "acme",
      view: "list",
    });
  });

  it("returns issue when a drawer path is open (with or without tab)", () => {
    expect(resolveMaestroContext("/projects/acme/board/issues/ACME-12")).toEqual({
      kind: "issue",
      projectSlug: "acme",
      view: "board",
      issueIdentifier: "ACME-12",
    });
    expect(resolveMaestroContext("/projects/acme/list/issues/ACME-12/summary")).toEqual({
      kind: "issue",
      projectSlug: "acme",
      view: "list",
      issueIdentifier: "ACME-12",
    });
  });

  it("returns kb for a project page and the general KB page", () => {
    expect(resolveMaestroContext("/projects/acme/kb/apps~web/guide.md")).toEqual({
      kind: "kb",
      projectSlug: "acme",
      repoSlug: "apps~web",
      pagePath: "guide.md",
    });
    expect(resolveMaestroContext("/kb/index.md")).toEqual({
      kind: "kb",
      projectSlug: "@user",
      repoSlug: "@user~symphony-kb",
      pagePath: "index.md",
    });
  });

  it("returns null on KB roots without a selected page", () => {
    expect(resolveMaestroContext("/kb")).toBeNull();
    expect(resolveMaestroContext("/projects/acme/kb")).toBeNull();
    expect(resolveMaestroContext("/projects/acme/kb/apps~web")).toBeNull();
  });

  it("returns null on workspaces and full-page assistant routes", () => {
    expect(resolveMaestroContext("/projects/acme/workspaces")).toBeNull();
    expect(resolveMaestroContext("/projects/acme/workspaces/12")).toBeNull();
    expect(resolveMaestroContext("/assistant")).toBeNull();
    expect(resolveMaestroContext("/assistant/9")).toBeNull();
    expect(resolveMaestroContext("/projects/acme/assistant")).toBeNull();
  });

  it("ignores query strings when matching", () => {
    expect(resolveMaestroContext("/projects/acme/board?foo=bar")).toEqual({
      kind: "project",
      projectSlug: "acme",
      view: "board",
    });
  });
});

describe("maestroContextKey", () => {
  it("produces a stable key per context", () => {
    expect(maestroContextKey({ kind: "home", surface: "observability" })).toBe(
      "home:observability",
    );
    expect(
      maestroContextKey({ kind: "issue", projectSlug: "acme", issueIdentifier: "ACME-1", view: "board" }),
    ).toBe("issue:acme:ACME-1");
  });
});
