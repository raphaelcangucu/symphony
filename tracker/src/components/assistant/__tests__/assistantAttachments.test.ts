import { describe, expect, it } from "vitest";

import {
  hydrateAttachments,
  serializeAttachments,
  type AssistantAttachment,
  type AssistantOutgoingAttachment,
} from "@/components/assistant/assistantAttachments";

describe("hydrateAttachments", () => {
  it("round-trips image, file, and audio outgoing attachments", () => {
    const outgoing: AssistantOutgoingAttachment[] = [
      {
        type: "image",
        name: "diagram.png",
        media_type: "image/png",
        path: "uploads/diagram.png",
      },
      {
        type: "file",
        name: "notes.md",
        media_type: "text/markdown",
        path: "uploads/notes.md",
      },
      {
        type: "audio",
        name: "clip.webm",
        media_type: "audio/webm",
        data: "YWJj",
        transcript: "hello",
      },
    ];

    const hydrated = hydrateAttachments(outgoing);
    expect(hydrated).toHaveLength(3);
    expect(hydrated[0]).toMatchObject({
      type: "image",
      name: "diagram.png",
      mediaType: "image/png",
      path: "uploads/diagram.png",
    });
    expect(hydrated[1]).toMatchObject({
      type: "file",
      name: "notes.md",
      mediaType: "text/markdown",
      path: "uploads/notes.md",
    });
    expect(hydrated[2]).toMatchObject({
      type: "audio",
      name: "clip.webm",
      mediaType: "audio/webm",
      dataUrl: "data:audio/webm;base64,YWJj",
      transcript: "hello",
    });

    const reserialized = serializeAttachments(hydrated as AssistantAttachment[]);
    expect(reserialized).toEqual(outgoing);
  });

  it("skips invalid outgoing attachments without a usable payload", () => {
    expect(
      hydrateAttachments([
        { type: "image", name: "missing.png", media_type: "image/png" },
        { type: "audio", name: "silent.webm", media_type: "audio/webm" },
      ]),
    ).toEqual([]);
  });
});
