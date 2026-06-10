import { describe, expect, it } from "vitest";

import { extractFilesFromClipboard, extractImageFilesFromClipboard } from "@/lib/clipboardImages";

function imageFile(name = "shot.png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

function markdownFile(name = "notes.md"): File {
  return new File(["# Title"], name, { type: "text/markdown" });
}

function clipboardData(init: Partial<Pick<DataTransfer, "items" | "files">>): DataTransfer {
  return init as unknown as DataTransfer;
}

describe("extractImageFilesFromClipboard", () => {
  it("returns image files delivered as clipboard items", () => {
    const file = imageFile();
    const event = {
      clipboardData: clipboardData({
        items: [
          { kind: "file", type: "image/png", getAsFile: () => file },
          { kind: "string", type: "text/plain", getAsFile: () => null },
        ] as unknown as DataTransferItemList,
      }),
    };

    expect(extractImageFilesFromClipboard(event)).toEqual([file]);
  });

  it("falls back to clipboard files when no image items are present", () => {
    const file = imageFile("pasted.png");
    const event = {
      clipboardData: clipboardData({
        items: [] as unknown as DataTransferItemList,
        files: [file] as unknown as FileList,
      }),
    };

    expect(extractImageFilesFromClipboard(event)).toEqual([file]);
  });

  it("ignores non-image content", () => {
    const event = {
      clipboardData: clipboardData({
        items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] as unknown as DataTransferItemList,
      }),
    };

    expect(extractImageFilesFromClipboard(event)).toEqual([]);
  });

  it("returns nothing when clipboardData is absent", () => {
    expect(extractImageFilesFromClipboard({ clipboardData: null })).toEqual([]);
  });
});

describe("extractFilesFromClipboard", () => {
  it("returns any pasted file regardless of type", () => {
    const md = markdownFile();
    const event = {
      clipboardData: clipboardData({
        items: [{ kind: "file", type: "text/markdown", getAsFile: () => md }] as unknown as DataTransferItemList,
      }),
    };

    expect(extractFilesFromClipboard(event)).toEqual([md]);
  });

  it("ignores string clipboard items so plain text paste is unaffected", () => {
    const event = {
      clipboardData: clipboardData({
        items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] as unknown as DataTransferItemList,
      }),
    };

    expect(extractFilesFromClipboard(event)).toEqual([]);
  });
});
