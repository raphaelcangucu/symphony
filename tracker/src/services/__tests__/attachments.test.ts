import { describe, expect, it } from "vitest";

import {
  isInternalAttachmentUrl,
  isVideoAttachmentSource,
  isVideoMediaType,
  projectAttachmentUrl,
} from "@/services/attachments";

describe("projectAttachmentUrl", () => {
  it("builds an authenticated tracker API path for a stored attachment", () => {
    expect(projectAttachmentUrl("gamba", "uploads/abc123.png")).toBe(
      "/api/tracker/v1/projects/gamba/assistant/attachments/uploads/abc123.png",
    );
  });

  it("trims a leading slash from the relative path", () => {
    expect(projectAttachmentUrl("gamba", "/uploads/abc.png")).toBe(
      "/api/tracker/v1/projects/gamba/assistant/attachments/uploads/abc.png",
    );
  });

  it("throws when the project slug is blank", () => {
    expect(() => projectAttachmentUrl("  ", "uploads/abc.png")).toThrow();
  });

  it("throws when the relative path is blank", () => {
    expect(() => projectAttachmentUrl("gamba", "  ")).toThrow();
  });
});

describe("isInternalAttachmentUrl", () => {
  it("recognizes attachment API paths", () => {
    expect(isInternalAttachmentUrl("/api/tracker/v1/projects/gamba/assistant/attachments/uploads/x.png")).toBe(true);
  });

  it("rejects external, data, and blob URLs", () => {
    expect(isInternalAttachmentUrl("https://example.com/x.png")).toBe(false);
    expect(isInternalAttachmentUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isInternalAttachmentUrl("blob:http://localhost/x")).toBe(false);
    expect(isInternalAttachmentUrl("")).toBe(false);
    expect(isInternalAttachmentUrl(null)).toBe(false);
  });

  it("rejects other tracker API paths", () => {
    expect(isInternalAttachmentUrl("/api/tracker/v1/projects/gamba/issues/GAM-2")).toBe(false);
  });
});

describe("isVideoMediaType", () => {
  it("recognizes video MIME types", () => {
    expect(isVideoMediaType("video/webm")).toBe(true);
    expect(isVideoMediaType("video/mp4")).toBe(true);
  });

  it("rejects non-video MIME types", () => {
    expect(isVideoMediaType("audio/webm")).toBe(false);
    expect(isVideoMediaType("image/png")).toBe(false);
    expect(isVideoMediaType(null)).toBe(false);
  });
});

describe("isVideoAttachmentSource", () => {
  it("recognizes webm and mp4 paths", () => {
    expect(
      isVideoAttachmentSource("/api/tracker/v1/projects/gamba/assistant/attachments/uploads/abc.webm"),
    ).toBe(true);
    expect(isVideoAttachmentSource("uploads/demo.MP4")).toBe(true);
  });

  it("rejects other extensions", () => {
    expect(isVideoAttachmentSource("/uploads/shot.png")).toBe(false);
    expect(isVideoAttachmentSource("")).toBe(false);
  });
});
