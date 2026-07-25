import type { RpcRequest, RpcResponse } from "./mock-server-rpc-handlers";

type Respond = (response: RpcResponse) => void;
type Success = (id: string, result: unknown) => RpcResponse;
type ErrorResponse = (id: string, code: string, message: string) => RpcResponse;

const MOCK_IMAGE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8sm7wAAAABJRU5ErkJggg==";

const MOCK_FILE_CONTENT: Record<string, string> = {
  "README.md": "# Dev10x mobile preview\n\nThis file is served by the Symphony mock host.",
  "src/app.ts": "export const dev10xMobilePreview = 'ready'\n",
  "public/index.html":
    "<main><h1>Dev10x mobile preview</h1><p>Symphony RPC preview is ready.</p></main>",
};

const MOCK_FILE_LIST = [
  { relativePath: "README.md", basename: "README.md", kind: "text" },
  { relativePath: "src/app.ts", basename: "app.ts", kind: "text" },
  { relativePath: "public/index.html", basename: "index.html", kind: "text" },
  { relativePath: "assets/logo.png", basename: "logo.png", kind: "binary" },
  { relativePath: "dist/archive.zip", basename: "archive.zip", kind: "binary" },
];

function readMockDirectory(
  relativePath: string,
): Array<{ name: string; isDirectory: boolean; isSymlink: boolean }> {
  const prefix = relativePath ? `${relativePath}/` : "";
  const children = new Map<string, boolean>();
  for (const file of MOCK_FILE_LIST) {
    if (!file.relativePath.startsWith(prefix)) continue;
    const rest = file.relativePath.slice(prefix.length);
    if (!rest) continue;
    const [name, ...descendants] = rest.split("/");
    if (!name) continue;
    children.set(name, children.get(name) === true || descendants.length > 0);
  }
  return Array.from(children, ([name, isDirectory]) => ({
    name,
    isDirectory,
    isSymlink: false,
  })).sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function handleMockFilePreviewRequest(
  request: RpcRequest,
  respond: Respond,
  success: Success,
  error: ErrorResponse,
): boolean {
  switch (request.method) {
    case "files.list":
      respond(
        success(request.id, {
          worktree: "101",
          rootPath: "/tmp/dev10x-mobile-mock/symphony",
          files: MOCK_FILE_LIST,
          totalCount: MOCK_FILE_LIST.length,
          truncated: false,
        }),
      );
      return true;

    case "files.readDir":
      respond(success(request.id, readMockDirectory(String(request.params.relativePath ?? ""))));
      return true;

    case "files.read": {
      const relativePath = String(request.params.relativePath ?? "");
      const content = MOCK_FILE_CONTENT[relativePath];
      if (content == null) {
        respond(error(request.id, "not_found", "File not found"));
        return true;
      }
      respond(
        success(request.id, {
          worktree: "101",
          relativePath,
          content,
          truncated: false,
          byteLength: Buffer.byteLength(content, "utf8"),
        }),
      );
      return true;
    }

    case "files.readPreview": {
      const relativePath = String(request.params.relativePath ?? "");
      if (relativePath !== "assets/logo.png") {
        respond(error(request.id, "binary_file", "binary_file"));
        return true;
      }
      respond(
        success(request.id, {
          content: MOCK_IMAGE_PNG_BASE64,
          isBinary: true,
          isImage: true,
          mimeType: "image/png",
        }),
      );
      return true;
    }

    case "files.readTerminalArtifact": {
      const content = "# Dev10x terminal artifact\n";
      respond(
        success(request.id, {
          worktree: "101",
          absolutePath: String(request.params.absolutePath ?? "/tmp/dev10x-artifact.md"),
          content,
          truncated: false,
          byteLength: Buffer.byteLength(content, "utf8"),
        }),
      );
      return true;
    }

    case "files.readTerminalArtifactPreview":
      respond(
        success(request.id, {
          content: MOCK_IMAGE_PNG_BASE64,
          isBinary: true,
          isImage: true,
          mimeType: "image/png",
        }),
      );
      return true;

    case "files.open":
    case "files.openDiff": {
      const relativePath = String(request.params.relativePath ?? "");
      respond(
        success(request.id, {
          worktree: "101",
          relativePath,
          kind: relativePath.endsWith(".md") ? "markdown" : "text",
          opened: true,
          diff: request.method === "files.openDiff",
        }),
      );
      return true;
    }

    case "files.resolveTerminalPath": {
      const relativePath = String(request.params.pathText ?? "").replace(/^\.?\//, "");
      respond(
        success(request.id, {
          worktree: "101",
          relativePath,
          absolutePath: `/tmp/dev10x-mobile-mock/symphony/${relativePath}`,
          exists: MOCK_FILE_LIST.some((file) => file.relativePath === relativePath),
          isDirectory: false,
          openTarget: {
            kind: "worktree-file",
            provider: "local",
            relativePath,
            absolutePath: `/tmp/dev10x-mobile-mock/symphony/${relativePath}`,
          },
        }),
      );
      return true;
    }

    default:
      return false;
  }
}
