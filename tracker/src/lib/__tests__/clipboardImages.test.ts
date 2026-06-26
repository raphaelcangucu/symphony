import { describe, expect, it } from "vitest";

import { extractFilesFromClipboard, extractImageFilesFromClipboard } from "@/lib/clipboardImages";
import { filterImageFiles, isImageFile, normalizeImageFile } from "@/lib/imageFiles";

function imageFile(name = "shot.png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

function clipboardData(init: Partial<Pick<DataTransfer, "items" | "files">>): DataTransfer {
  return init as unknown as DataTransfer;
}

describe("imageFiles", () => {
  it("detects screenshots with an empty File.type when the clipboard item is image/png", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "", { type: "" });
    expect(isImageFile(file, "image/png")).toBe(true);
    expect(normalizeImageFile(file, "image/png").type).toBe("image/png");
  });

  it("detects Explorer files by extension when type is missing", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "diagram.PNG", { type: "" });
    expect(filterImageFiles([file])).toHaveLength(1);
  });
});

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

  it("accepts screenshots with empty file metadata", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "", { type: "" });
    const event = {
      clipboardData: clipboardData({
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }] as unknown as DataTransferItemList,
      }),
    };

    const [normalized] = extractImageFilesFromClipboard(event);
    expect(normalized.type).toBe("image/png");
    expect(normalized.name).toBe("pasted.png");
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
    const md = new File(["# Title"], "notes.md", { type: "text/markdown" });
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
