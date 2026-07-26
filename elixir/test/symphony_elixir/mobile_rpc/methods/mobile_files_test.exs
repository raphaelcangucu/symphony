defmodule SymphonyElixir.MobileRpc.Methods.MobileFilesTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.MobileRpc.{Dispatcher, MobileFileService}

  @methods ~w(
    files.list
    files.readDir
    files.read
    files.readPreview
    files.open
    files.openDiff
    files.resolveTerminalPath
    files.readTerminalArtifact
    files.readTerminalArtifactPreview
    files.writeTerminalArtifact
    browser.screencast
    browser.mouseDown
    browser.mouseMove
    browser.mouseUp
    browser.mouseWheel
    clipboard.startImageUpload
    clipboard.appendImageUploadChunk
    clipboard.commitImageUpload
    clipboard.abortImageUpload
    clipboard.saveImageAsTempFile
  )

  @one_pixel_png Base.decode64!("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8sm7wAAAABJRU5ErkJggg==")

  defmodule FakeFileService do
    def call("files.readDir", %{"worktree" => "id:42", "relativePath" => ""}, context) do
      {:ok,
       [
         %{"name" => "src", "isDirectory" => true, "isSymlink" => false},
         %{"name" => "README.md", "isDirectory" => false, "isSymlink" => false}
       ]
       |> Enum.map(&Map.put(&1, "hostId", context.host_id))}
    end

    def call("files.read", %{"worktree" => "id:42", "relativePath" => "README.md"}, context) do
      {:ok,
       %{
         "worktree" => "42",
         "relativePath" => "README.md",
         "content" => "# #{context.host_id}",
         "truncated" => false,
         "byteLength" => byte_size("# #{context.host_id}")
       }}
    end

    def call(method, params, context) do
      {:ok, %{"method" => method, "params" => params, "hostId" => context.host_id}}
    end

    def subscribe("browser.screencast", _params, _context) do
      {:error, {:rpc_error, "capability_unavailable", "Browser screencast is unavailable", false, nil}}
    end
  end

  setup do
    root = Path.join(System.tmp_dir!(), "dev10x-orca-files-#{System.unique_integer([:positive])}")
    workspace = Path.join(root, "workspace")
    outside = Path.join(root, "artifact.txt")
    clipboard_dir = Path.join(root, "clipboard")

    File.mkdir_p!(Path.join(workspace, "src"))
    File.write!(Path.join(workspace, "README.md"), "# Dev10x\n")
    File.write!(Path.join(workspace, "src/app.ex"), "defmodule Dev10x.App do\nend\n")
    File.write!(Path.join(workspace, "logo.png"), @one_pixel_png)
    File.write!(outside, "before")

    on_exit(fn -> File.rm_rf!(root) end)

    resolver = fn
      "id:42" ->
        {:ok,
         %{
           id: 42,
           project_slug: "symphony",
           workspace_path: workspace
         }}

      _selector ->
        {:error, :not_found}
    end

    context = %{
      host_id: "host-a",
      device_id: "device-a",
      orca_workspace_resolver: resolver,
      orca_clipboard_dir: clipboard_dir,
      orca_terminal_output: fn "thread:42" -> {:ok, "created #{outside}"} end
    }

    %{context: context, workspace: workspace, outside: outside}
  end

  test "registers the exact copied file, browser and clipboard surface" do
    dispatcher =
      Dispatcher.new(%{
        host_id: "host-a",
        protocol: 1,
        device_id: "device-a",
        connection_pid: self(),
        orca_file_service: FakeFileService
      })

    assert MapSet.subset?(MapSet.new(@methods), MapSet.new(Map.keys(dispatcher.methods)))

    assert [
             %{
               "name" => "src",
               "isDirectory" => true,
               "isSymlink" => false,
               "hostId" => "host-a"
             },
             %{"name" => "README.md", "isDirectory" => false}
           ] =
             dispatch(dispatcher, "files.readDir", %{
               "worktree" => "id:42",
               "relativePath" => ""
             })

    assert %{
             "worktree" => "42",
             "relativePath" => "README.md",
             "content" => "# host-a",
             "truncated" => false
           } =
             dispatch(dispatcher, "files.read", %{
               "worktree" => "id:42",
               "relativePath" => "README.md"
             })
  end

  test "copies Orca file DTOs while keeping every path inside the selected worktree", %{
    context: context,
    workspace: workspace,
    outside: outside
  } do
    assert {:ok,
            %{
              "worktree" => "42",
              "files" => files,
              "totalCount" => 3,
              "truncated" => false
            }} = MobileFileService.call("files.list", %{"worktree" => "id:42"}, context)

    assert Enum.any?(files, &(&1["relativePath"] == "README.md" and &1["kind"] == "text"))
    assert Enum.any?(files, &(&1["relativePath"] == "logo.png" and &1["kind"] == "binary"))

    assert {:ok,
            [
              %{"name" => "src", "isDirectory" => true, "isSymlink" => false},
              %{"name" => "logo.png", "isDirectory" => false},
              %{"name" => "README.md", "isDirectory" => false}
            ]} =
             MobileFileService.call(
               "files.readDir",
               %{"worktree" => "id:42", "relativePath" => ""},
               context
             )

    assert {:ok,
            %{
              "worktree" => "42",
              "relativePath" => "README.md",
              "content" => "# Dev10x\n",
              "truncated" => false,
              "byteLength" => 9
            }} =
             MobileFileService.call(
               "files.read",
               %{"worktree" => "id:42", "relativePath" => "README.md"},
               context
             )

    assert {:error, {:rpc_error, "invalid_relative_path", _, false, nil}} =
             MobileFileService.call(
               "files.read",
               %{"worktree" => "id:42", "relativePath" => "../../etc/passwd"},
               context
             )

    File.ln_s!(outside, Path.join(workspace, "outside-link.txt"))

    assert {:error, {:rpc_error, "invalid_relative_path", _, false, nil}} =
             MobileFileService.call(
               "files.read",
               %{"worktree" => "id:42", "relativePath" => "outside-link.txt"},
               context
             )
  end

  test "caps reads before loading content and returns copied image previews", %{
    context: context,
    workspace: workspace
  } do
    File.write!(Path.join(workspace, "too-large.txt"), :binary.copy("x", 512 * 1024 + 1))

    assert {:error, {:rpc_error, "file_too_large", _, false, nil}} =
             MobileFileService.call(
               "files.read",
               %{"worktree" => "id:42", "relativePath" => "too-large.txt"},
               context
             )

    assert {:ok,
            %{
              "content" => encoded,
              "isBinary" => true,
              "isImage" => true,
              "mimeType" => "image/png"
            }} =
             MobileFileService.call(
               "files.readPreview",
               %{"worktree" => "id:42", "relativePath" => "logo.png"},
               context
             )

    assert Base.decode64!(encoded) == @one_pixel_png
  end

  test "resolves worktree files and grants only terminal-proven temporary artifacts", %{
    context: context,
    outside: outside
  } do
    assert {:ok,
            %{
              "worktree" => "42",
              "relativePath" => "src/app.ex",
              "exists" => true,
              "isDirectory" => false,
              "openTarget" => %{
                "kind" => "worktree-file",
                "provider" => "local",
                "relativePath" => "src/app.ex"
              }
            }} =
             MobileFileService.call(
               "files.resolveTerminalPath",
               %{
                 "worktree" => "id:42",
                 "pathText" => "app.ex",
                 "cwd" => "src",
                 "terminal" => "thread:42"
               },
               context
             )

    assert {:ok,
            %{
              "exists" => true,
              "openTarget" => %{
                "kind" => "absolute-file",
                "absolutePath" => ^outside,
                "grantId" => grant_id
              }
            }} =
             MobileFileService.call(
               "files.resolveTerminalPath",
               %{
                 "worktree" => "id:42",
                 "pathText" => outside,
                 "terminal" => "thread:42"
               },
               context
             )

    assert {:ok, %{"content" => "before", "truncated" => false, "byteLength" => 6}} =
             MobileFileService.call(
               "files.readTerminalArtifact",
               %{
                 "worktree" => "id:42",
                 "grantId" => grant_id,
                 "absolutePath" => outside
               },
               context
             )

    assert {:ok, %{"written" => true, "byteLength" => 5}} =
             MobileFileService.call(
               "files.writeTerminalArtifact",
               %{
                 "worktree" => "id:42",
                 "grantId" => grant_id,
                 "absolutePath" => outside,
                 "content" => "after"
               },
               context
             )

    assert File.read!(outside) == "after"

    denied_context = %{context | orca_terminal_output: fn _handle -> {:ok, "no artifact"} end}

    assert {:ok, %{"exists" => false, "openTarget" => nil}} =
             MobileFileService.call(
               "files.resolveTerminalPath",
               %{
                 "worktree" => "id:42",
                 "pathText" => outside,
                 "terminal" => "thread:42"
               },
               denied_context
             )
  end

  test "bounds chunked clipboard uploads and saves the result on the selected host", %{
    context: context
  } do
    assert {:error, {:rpc_error, "image_too_large", _, false, nil}} =
             MobileFileService.call(
               "clipboard.startImageUpload",
               %{"expectedBase64Length" => 24 * 1024 * 1024 + 1, "connectionId" => "mobile"},
               context
             )

    encoded = Base.encode64("dev10x-image")

    assert {:ok, %{"uploadId" => upload_id}} =
             MobileFileService.call(
               "clipboard.startImageUpload",
               %{"expectedBase64Length" => byte_size(encoded), "connectionId" => "mobile"},
               context
             )

    assert {:ok, %{"receivedBase64Length" => size}} =
             MobileFileService.call(
               "clipboard.appendImageUploadChunk",
               %{"uploadId" => upload_id, "offset" => 0, "contentBase64" => encoded},
               context
             )

    assert size == byte_size(encoded)
    assert {:ok, saved_path} = MobileFileService.call("clipboard.commitImageUpload", %{"uploadId" => upload_id}, context)
    assert File.read!(saved_path) == "dev10x-image"
  end

  test "keeps browser controls capability-gated when Symphony has no screencast adapter", %{
    context: context
  } do
    for method <- ~w(browser.mouseDown browser.mouseMove browser.mouseUp browser.mouseWheel) do
      assert {:error, {:rpc_error, "capability_unavailable", _, false, nil}} =
               MobileFileService.call(
                 method,
                 %{"worktree" => "id:42", "page" => "page-1"},
                 context
               )
    end

    assert {:error, {:rpc_error, "capability_unavailable", _, false, nil}} =
             MobileFileService.subscribe(
               "browser.screencast",
               %{"worktree" => "id:42", "page" => "page-1"},
               Map.put(context, :connection_pid, self())
             )
  end

  defp dispatch(dispatcher, method, params) do
    frame =
      Jason.encode!(%{
        "type" => "rpc",
        "id" => "rpc-#{System.unique_integer([:positive])}",
        "method" => method,
        "params" => params
      })

    assert {:noreply, running} = Dispatcher.handle_frame(frame, dispatcher)
    assert_receive {ref, _result} = task_message when is_reference(ref)
    assert {:reply, response, _complete} = Dispatcher.handle_info(task_message, running)
    decoded = Jason.decode!(response)
    assert decoded["ok"] == true
    decoded["result"]
  end
end
