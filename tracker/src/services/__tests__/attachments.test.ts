import { describe, expect, it } from "vitest";

import {
  isEvidenceArtifactUrl,
  isInternalAttachmentUrl,
  isTrackerAuthenticatedMediaUrl,
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

describe("isEvidenceArtifactUrl", () => {
  it("recognizes relative evidence artifact paths", () => {
    expect(
      isEvidenceArtifactUrl(
        "/api/tracker/v1/projects/gamba/issues/1878/evidence/20260610-1/artifacts/artifacts/screens/home.png",
      ),
    ).toBe(true);
  });

  it("recognizes absolute evidence artifact URLs", () => {
    expect(
      isEvidenceArtifactUrl(
        "http://localhost:4000/api/tracker/v1/projects/gamba/issues/1878/evidence/20260610-1/artifacts/artifacts/videos/flow.webm",
      ),
    ).toBe(true);
  });

  it("rejects external URLs", () => {
    expect(isEvidenceArtifactUrl("https://example.com/evidence/artifacts/x.png")).toBe(false);
  });
});

describe("isTrackerAuthenticatedMediaUrl", () => {
  it("includes assistant attachments and evidence artifacts", () => {
    expect(
      isTrackerAuthenticatedMediaUrl(
        "/api/tracker/v1/projects/gamba/assistant/attachments/uploads/x.png",
      ),
    ).toBe(true);
    expect(
      isTrackerAuthenticatedMediaUrl(
        "http://localhost:4000/api/tracker/v1/projects/gamba/issues/1878/evidence/run/artifacts/s.png",
      ),
    ).toBe(true);
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
