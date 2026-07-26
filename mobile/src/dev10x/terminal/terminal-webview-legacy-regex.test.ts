import { describe, expect, it } from "vitest";

import { XTERM_HTML } from "./terminal-webview-html";

describe("terminal WebView legacy JavaScript compatibility", () => {
  it("constructs Unicode word matching at runtime so old parsers can use the ASCII fallback", () => {
    expect(XTERM_HTML).not.toContain("var WORD_RE = /[\\p{L}\\p{N}");
    expect(XTERM_HTML).toContain("WORD_RE = new RegExp('[\\\\p{L}\\\\p{N}");
    expect(XTERM_HTML).toContain("WORD_RE = /[A-Za-z0-9_./:@~+=?&#%-]/;");
  });
});
