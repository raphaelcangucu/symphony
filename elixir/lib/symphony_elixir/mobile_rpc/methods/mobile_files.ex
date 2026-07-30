defmodule SymphonyElixir.MobileRpc.Methods.MobileFiles do
  @moduledoc "Orca-compatible worktree files, browser controls and clipboard uploads."

  @spec modules() :: [module()]
  def modules do
    [
      __MODULE__.FilesList,
      __MODULE__.FilesReadDir,
      __MODULE__.FilesRead,
      __MODULE__.FilesReadPreview,
      __MODULE__.FilesOpen,
      __MODULE__.FilesOpenDiff,
      __MODULE__.FilesResolveTerminalPath,
      __MODULE__.FilesReadTerminalArtifact,
      __MODULE__.FilesReadTerminalArtifactPreview,
      __MODULE__.FilesWriteTerminalArtifact,
      __MODULE__.BrowserScreencast,
      __MODULE__.BrowserMouseDown,
      __MODULE__.BrowserMouseMove,
      __MODULE__.BrowserMouseUp,
      __MODULE__.BrowserMouseWheel,
      __MODULE__.ClipboardStartImageUpload,
      __MODULE__.ClipboardAppendImageUploadChunk,
      __MODULE__.ClipboardCommitImageUpload,
      __MODULE__.ClipboardAbortImageUpload,
      __MODULE__.ClipboardSaveImageAsTempFile
    ]
  end

  defmodule FilesList do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "files.list",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree"],
      required_keys: ["worktree"],
      timeout_ms: 30_000
  end

  defmodule FilesReadDir do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "files.readDir",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "relativePath"],
      required_keys: ["worktree", "relativePath"],
      nullable_required_keys: ["relativePath"]
  end

  defmodule FilesRead do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "files.read",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "relativePath"],
      required_keys: ["worktree", "relativePath"]
  end

  defmodule FilesReadPreview do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "files.readPreview",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "relativePath"],
      required_keys: ["worktree", "relativePath"]
  end

  defmodule FilesOpen do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "files.open",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "relativePath"],
      required_keys: ["worktree", "relativePath"]
  end

  defmodule FilesOpenDiff do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "files.openDiff",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "relativePath", "staged"],
      required_keys: ["worktree", "relativePath"]
  end

  defmodule FilesResolveTerminalPath do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "files.resolveTerminalPath",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "pathText", "terminal", "cwd"],
      required_keys: ["worktree", "pathText"]
  end

  defmodule FilesReadTerminalArtifact do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "files.readTerminalArtifact",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "grantId", "absolutePath"],
      required_keys: ["worktree", "grantId", "absolutePath"]
  end

  defmodule FilesReadTerminalArtifactPreview do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "files.readTerminalArtifactPreview",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "grantId", "absolutePath"],
      required_keys: ["worktree", "grantId", "absolutePath"]
  end

  defmodule FilesWriteTerminalArtifact do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "files.writeTerminalArtifact",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "grantId", "absolutePath", "content"],
      required_keys: ["worktree", "grantId", "absolutePath", "content"],
      nullable_required_keys: ["content"]
  end

  defmodule BrowserScreencast do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "browser.screencast",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      subscription: true,
      allowed_keys: [
        "worktree",
        "page",
        "format",
        "quality",
        "maxWidth",
        "maxHeight",
        "viewportWidth",
        "viewportHeight",
        "deviceScaleFactor",
        "mobile",
        "everyNthFrame",
        "minFrameIntervalMs"
      ]
  end

  defmodule BrowserMouseDown do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "browser.mouseDown",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "page", "button"],
      required_keys: ["button"]
  end

  defmodule BrowserMouseMove do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "browser.mouseMove",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "page", "x", "y"],
      required_keys: ["x", "y"]
  end

  defmodule BrowserMouseUp do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "browser.mouseUp",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "page", "button"],
      required_keys: ["button"]
  end

  defmodule BrowserMouseWheel do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "browser.mouseWheel",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["worktree", "page", "dx", "dy"],
      required_keys: ["dx", "dy"]
  end

  defmodule ClipboardStartImageUpload do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "clipboard.startImageUpload",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["expectedBase64Length", "connectionId"],
      required_keys: ["expectedBase64Length"]
  end

  defmodule ClipboardAppendImageUploadChunk do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "clipboard.appendImageUploadChunk",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["uploadId", "offset", "contentBase64"],
      required_keys: ["uploadId", "offset", "contentBase64"],
      nullable_required_keys: ["contentBase64"]
  end

  defmodule ClipboardCommitImageUpload do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "clipboard.commitImageUpload",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["uploadId"],
      required_keys: ["uploadId"]
  end

  defmodule ClipboardAbortImageUpload do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "clipboard.abortImageUpload",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["uploadId"],
      required_keys: ["uploadId"]
  end

  defmodule ClipboardSaveImageAsTempFile do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "clipboard.saveImageAsTempFile",
      service: SymphonyElixir.MobileRpc.MobileFileService,
      service_key: :orca_file_service,
      allowed_keys: ["contentBase64", "connectionId"],
      required_keys: ["contentBase64"]
  end
end
