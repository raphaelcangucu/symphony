defmodule SymphonyElixir.MobileRpc.Methods.MobileGitTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.MobileRpc.{Dispatcher, MobileGitService}

  @methods ~w(
    git.status
    git.diff
    git.branchDiff
    git.branchCompare
    git.commitCompare
    git.history
    git.stage
    git.commit
    git.push
    git.generateCommitMessage
    git.cancelGenerateCommitMessage
    git.generatePullRequestFields
    hostedReview.getCreationEligibility
  )

  defmodule FakeGitService do
    def call("git.status", %{"worktree" => "id:42"}, context) do
      {:ok,
       %{
         "entries" => [
           %{"path" => "lib/app.ex", "status" => "modified", "area" => "unstaged"}
         ],
         "conflictOperation" => "unknown",
         "branch" => "feature/dev10x",
         "head" => context.host_id
       }}
    end

    def call(method, params, context) do
      {:ok, %{"method" => method, "params" => params, "hostId" => context.host_id}}
    end
  end

  setup do
    root = Path.join(System.tmp_dir!(), "dev10x-orca-git-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    git!(root, ["init", "-b", "main"])
    git!(root, ["config", "user.email", "dev10x@example.test"])
    git!(root, ["config", "user.name", "Dev10x Test"])
    File.write!(Path.join(root, "README.md"), "# Dev10x\n")
    git!(root, ["add", "README.md"])
    git!(root, ["commit", "-m", "chore: initial"])
    baseline = git!(root, ["rev-parse", "HEAD"])

    on_exit(fn -> File.rm_rf!(root) end)

    resolver = fn
      "id:42" -> {:ok, %{id: 42, project_slug: "symphony", workspace_path: root}}
      _selector -> {:error, :not_found}
    end

    context = %{
      host_id: "host-a",
      device_id: "device-a",
      orca_workspace_resolver: resolver
    }

    %{context: context, root: root, baseline: baseline}
  end

  test "registers exact copied Git methods and scopes results to the selected host" do
    dispatcher =
      Dispatcher.new(%{
        host_id: "host-a",
        protocol: 1,
        device_id: "device-a",
        connection_pid: self(),
        orca_git_service: FakeGitService
      })

    assert MapSet.subset?(MapSet.new(@methods), MapSet.new(Map.keys(dispatcher.methods)))

    assert %{
             "entries" => [
               %{"path" => "lib/app.ex", "status" => "modified", "area" => "unstaged"}
             ],
             "branch" => "feature/dev10x",
             "head" => "host-a"
           } = dispatch(dispatcher, "git.status", %{"worktree" => "id:42"})
  end

  test "separates staged, unstaged and untracked entries without leaving the workspace", %{
    context: context,
    root: root
  } do
    File.write!(Path.join(root, "README.md"), "# Dev10x mobile\n")
    File.write!(Path.join(root, "new.txt"), "new\n")

    assert {:ok, %{"entries" => entries, "branch" => "main", "head" => head}} =
             MobileGitService.call("git.status", %{"worktree" => "id:42"}, context)

    assert is_binary(head)
    assert Enum.any?(entries, &(&1 == %{"path" => "README.md", "status" => "modified", "area" => "unstaged"}))
    assert Enum.any?(entries, &(&1 == %{"path" => "new.txt", "status" => "untracked", "area" => "untracked"}))

    assert {:ok, %{"staged" => true, "filePath" => "README.md"}} =
             MobileGitService.call(
               "git.stage",
               %{"worktree" => "id:42", "filePath" => "README.md"},
               context
             )

    assert {:ok, %{"entries" => staged_entries}} =
             MobileGitService.call("git.status", %{"worktree" => "id:42"}, context)

    assert Enum.any?(staged_entries, &(&1 == %{"path" => "README.md", "status" => "modified", "area" => "staged"}))

    assert {:error, {:rpc_error, "invalid_path", _, false, nil}} =
             MobileGitService.call(
               "git.stage",
               %{"worktree" => "id:42", "filePath" => "--upload-pack=evil"},
               context
             )
  end

  test "returns copied text diff, history and compare DTOs", %{
    context: context,
    root: root,
    baseline: baseline
  } do
    File.write!(Path.join(root, "README.md"), "# Dev10x mobile\n")

    assert {:ok,
            %{
              "kind" => "text",
              "originalContent" => "# Dev10x\n",
              "modifiedContent" => "# Dev10x mobile\n"
            }} =
             MobileGitService.call(
               "git.diff",
               %{"worktree" => "id:42", "filePath" => "README.md", "staged" => false},
               context
             )

    assert {:ok,
            %{
              "items" => [
                %{
                  "id" => ^baseline,
                  "displayId" => display_id,
                  "subject" => "chore: initial",
                  "author" => "Dev10x Test"
                }
              ],
              "hasMore" => false,
              "limit" => 20
            }} =
             MobileGitService.call(
               "git.history",
               %{"worktree" => "id:42", "limit" => 20},
               context
             )

    assert byte_size(display_id) == 7

    assert {:ok,
            %{
              "summary" => %{
                "baseRef" => "main",
                "status" => "ready",
                "changedFiles" => 0
              },
              "entries" => []
            }} =
             MobileGitService.call(
               "git.branchCompare",
               %{"worktree" => "id:42", "baseRef" => "main"},
               context
             )

    assert {:ok,
            %{
              "summary" => %{
                "commitOid" => ^baseline,
                "status" => "ready",
                "changedFiles" => 1
              }
            }} =
             MobileGitService.call(
               "git.commitCompare",
               %{"worktree" => "id:42", "commitId" => baseline},
               context
             )
  end

  test "commits staged content idempotently and never stages unrelated files", %{
    context: context,
    root: root
  } do
    File.write!(Path.join(root, "README.md"), "# staged\n")
    File.write!(Path.join(root, "unrelated.txt"), "leave me\n")

    assert {:ok, _result} =
             MobileGitService.call(
               "git.stage",
               %{"worktree" => "id:42", "filePath" => "README.md"},
               context
             )

    assert {:ok, %{"success" => true, "committed" => true, "sha" => sha}} =
             MobileGitService.call(
               "git.commit",
               %{"worktree" => "id:42", "message" => "feat: copied source control"},
               context
             )

    assert sha == git!(root, ["rev-parse", "HEAD"])
    assert git!(root, ["status", "--porcelain"]) == "?? unrelated.txt"

    assert {:ok, %{"success" => true, "committed" => false, "sha" => ^sha}} =
             MobileGitService.call(
               "git.commit",
               %{"worktree" => "id:42", "message" => "feat: copied source control"},
               context
             )
  end

  test "normalizes push failures and returns safe generation and review eligibility", %{
    context: context
  } do
    push_context =
      Map.put(context, :orca_git_push, fn _root, _args ->
        {:error, "remote rejected: permission denied"}
      end)

    assert {:error, {:rpc_error, "push_failed", "Push failed: remote rejected: permission denied", true, nil}} =
             MobileGitService.call("git.push", %{"worktree" => "id:42"}, push_context)

    assert {:ok, %{"success" => true, "message" => message}} =
             MobileGitService.call(
               "git.generateCommitMessage",
               %{"worktree" => "id:42"},
               context
             )

    assert is_binary(message)

    assert {:ok,
            %{
              "success" => true,
              "fields" => %{"title" => title, "body" => body, "base" => "main", "draft" => true}
            }} =
             MobileGitService.call(
               "git.generatePullRequestFields",
               %{
                 "worktree" => "id:42",
                 "base" => "main",
                 "title" => "",
                 "body" => "",
                 "draft" => true
               },
               context
             )

    assert is_binary(title) and is_binary(body)

    assert {:ok,
            %{
              "provider" => "unsupported",
              "canCreate" => false,
              "blockedReason" => "unsupported_provider"
            }} =
             MobileGitService.call(
               "hostedReview.getCreationEligibility",
               %{"repo" => "id:repo", "worktree" => "id:42", "branch" => "main"},
               context
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

  defp git!(root, args) do
    case System.cmd("git", args, cd: root, stderr_to_stdout: true) do
      {output, 0} -> String.trim(output)
      {output, status} -> raise "git #{inspect(args)} failed (#{status}): #{output}"
    end
  end
end
