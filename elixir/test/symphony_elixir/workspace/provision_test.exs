defmodule SymphonyElixir.Workspace.ProvisionTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workspace.{Inventory, Provision}
  alias SymphonyElixir.{Workflow, Workspace, WorkspaceSkills}

  @ownership_marker Path.join([".symphony", "provisioning-owner"])
  @readiness_marker Path.join([".symphony", "ready"])
  @short_wait_ms 200
  @task_timeout_ms 2_000

  setup do
    previous_skills_root = Application.get_env(:symphony_elixir, :skills_root)

    test_root =
      Path.join(
        System.tmp_dir!(),
        "workspace-provision-test-#{System.unique_integer([:positive])}"
      )

    workspace_root = Path.join(test_root, "workspaces")
    skills_root = Path.join(test_root, "skills")

    File.mkdir_p!(workspace_root)
    write_skill!(skills_root, "commit")
    Application.put_env(:symphony_elixir, :skills_root, skills_root)
    configure_workflow!(workspace_root)

    on_exit(fn ->
      restore_skills_root(previous_skills_root)
      File.rm_rf!(test_root)
    end)

    {:ok, workspace_root: workspace_root, skills_root: skills_root}
  end

  test "concurrent callers for the same normalized path run after_create once", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-CONCURRENT")
    alias_segment = Path.join(workspace_root, "alias-segment")
    equivalent_workspace = Path.join([alias_segment, "..", "ATOMIC-CONCURRENT"])
    hook_counter = Path.join(workspace_root, "hook.count")
    parent = self()

    File.mkdir_p!(alias_segment)

    validator = fn _staging ->
      send(parent, {:validation_blocked, self()})

      receive do
        :continue_validation -> :ok
      end
    end

    first =
      Task.async(fn ->
        Provision.ensure(workspace,
          after_create: "printf 'x\\n' >> #{shell_quote(hook_counter)}",
          validator: validator
        )
      end)

    assert_receive {:validation_blocked, worker}, @task_timeout_ms
    refute File.exists?(workspace)

    second = Task.async(fn -> Provision.ensure(equivalent_workspace, []) end)

    second_observation = Task.yield(second, @short_wait_ms)
    send(worker, :continue_validation)
    first_result = Task.await(first, @task_timeout_ms)
    second_result = await_task_observation(second, second_observation)

    assert second_observation == nil
    assert first_result == {:ok, workspace}
    assert second_result == {:ok, workspace}
    assert File.read!(hook_counter) == "x\n"
  end

  test "an initial race elects exactly one provisioning owner", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-ELECTION")
    hook_counter = Path.join(workspace_root, "election-hook.count")
    parent = self()

    validator = fn _staging ->
      send(parent, {:election_blocked, self()})

      receive do
        :finish_election -> :ok
      end
    end

    first =
      Task.async(fn ->
        receive do
          :start ->
            Provision.ensure(workspace,
              after_create: "printf 'x\\n' >> #{shell_quote(hook_counter)}",
              validator: validator
            )
        end
      end)

    second =
      Task.async(fn ->
        receive do
          :start ->
            Provision.ensure(workspace,
              after_create: "printf 'x\\n' >> #{shell_quote(hook_counter)}",
              validator: validator
            )
        end
      end)

    send(first.pid, :start)
    send(second.pid, :start)
    assert_receive {:election_blocked, worker}, @task_timeout_ms
    assert Task.yield(first, @short_wait_ms) == nil
    assert Task.yield(second, @short_wait_ms) == nil
    send(worker, :finish_election)

    first_result = Task.await(first, @task_timeout_ms)
    second_result = Task.await(second, @task_timeout_ms)
    results = [first_result, second_result]

    assert Enum.count(results, &match?({:ok, ^workspace}, &1)) == 2
    assert File.read!(hook_counter) == "x\n"
  end

  test "concurrent callers share the same failed attempt result", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-SHARED-FAILURE")
    hook_counter = Path.join(workspace_root, "shared-failure.count")
    parent = self()

    validator = fn _staging ->
      send(parent, {:failure_blocked, self()})

      receive do
        :return_shared_failure -> {:error, :shared_validation_failure}
      end
    end

    first =
      Task.async(fn ->
        Provision.ensure(workspace,
          after_create: "printf 'x\\n' >> #{shell_quote(hook_counter)}",
          validator: validator
        )
      end)

    assert_receive {:failure_blocked, worker}, @task_timeout_ms
    second = Task.async(fn -> Provision.ensure(workspace, []) end)
    assert Task.yield(second, @short_wait_ms) == nil
    send(worker, :return_shared_failure)

    first_result = Task.await(first, @task_timeout_ms)
    second_result = Task.await(second, @task_timeout_ms)

    assert {:error,
            %{
              stage: :validate,
              reason: :shared_validation_failure
            }} = first_result

    assert second_result == first_result
    assert File.read!(hook_counter) == "x\n"
  end

  test "failed provisioning does not publish the final workspace", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-FAIL")

    configure_workflow!(workspace_root,
      hook_after_create: "printf 'hook failed\\n'; printf 'partial\\n' > partial.txt; exit 17"
    )

    assert {:error, error} = Workspace.ensure_at(workspace, "ATOMIC-FAIL")

    assert %{
             workspace: ^workspace,
             staging: staging,
             stage: :after_create,
             reason: {:workspace_hook_failed, "after_create", 17, output},
             retryable: true
           } = error

    assert output == "hook failed\n"
    refute File.exists?(workspace)
    refute File.exists?(staging)
    assert provisioning_container_entries(workspace) == []
  end

  test "a later call retries provisioning after a failed attempt", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-RETRY")
    configure_workflow!(workspace_root, hook_after_create: "printf 'partial\\n' > partial.txt; exit 23")

    assert {:error, %{retryable: true}} = Workspace.ensure_at(workspace, "ATOMIC-RETRY")
    refute File.exists?(workspace)

    configure_workflow!(workspace_root, hook_after_create: "printf 'complete\\n' > result.txt")

    assert {:ok, ^workspace} = Workspace.ensure_at(workspace, "ATOMIC-RETRY")
    assert File.read!(Path.join(workspace, "result.txt")) == "complete\n"
    refute File.exists?(Path.join(workspace, "partial.txt"))
  end

  test "after_create ignores the legacy hook timeout and waits for process exit", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-DELAY")
    completed = Path.join(workspace, "completed.txt")
    hook_started = Path.join(workspace_root, "hook-started.fifo")
    hook_release = Path.join(workspace_root, "hook-release.fifo")

    assert {"", 0} =
             System.cmd("mkfifo", [hook_started, hook_release], stderr_to_stdout: true)

    started_reader =
      Task.async(fn ->
        System.cmd("sh", ["-c", "cat < #{shell_quote(hook_started)}"], stderr_to_stdout: true)
      end)

    configure_workflow!(workspace_root,
      hook_timeout_ms: 5,
      hook_after_create:
        "printf 'started\\n' > #{shell_quote(hook_started)}; " <>
          "read release < #{shell_quote(hook_release)}; " <>
          "printf 'done\\n' > completed.txt"
    )

    provision = Task.async(fn -> Workspace.ensure_at(workspace, "ATOMIC-DELAY") end)
    assert {"started\n", 0} = Task.await(started_reader, @task_timeout_ms)
    assert Task.yield(provision, @short_wait_ms) == nil
    File.write!(hook_release, "continue\n")

    assert {:ok, ^workspace} = Task.await(provision, @task_timeout_ms)
    assert File.read!(completed) == "done\n"
  end

  test "issue workspace clones configured repositories on their selected branches without overrides", %{
    workspace_root: workspace_root
  } do
    project_slug = "provision-default-clone-#{System.unique_integer([:positive])}"
    seed = Path.join(workspace_root, "default-clone-seed")
    bare = Path.join(workspace_root, "default-clone-seed.git")

    File.mkdir_p!(seed)
    assert {"", 0} = System.cmd("git", ["init", "--quiet", "--initial-branch=main"], cd: seed)
    File.write!(Path.join(seed, "README.md"), "canonical seed\n")
    assert {"", 0} = System.cmd("git", ["add", "README.md"], cd: seed)

    assert {_output, 0} =
             System.cmd(
               "git",
               [
                 "-c",
                 "user.name=Symphony Test",
                 "-c",
                 "user.email=symphony-test@example.com",
                 "commit",
                 "--quiet",
                 "-m",
                 "seed"
               ],
               cd: seed
             )

    assert {_output, 0} = System.cmd("git", ["clone", "--quiet", "--bare", seed, bare])

    assert {:ok, _project} =
             Context.create_workspace_project(%{
               name: "Provision Default Clone",
               slug: project_slug,
               repositories: [
                 %{
                   github_full_name: "local/default-clone",
                   clone_url: bare,
                   default_branch: "main",
                   selected_branch: "main",
                   workspace_path: "site",
                   role: "application"
                 }
               ],
               setup: %{
                 workflow_markdown: Workflow.to_markdown(%{"workspace" => %{"root" => workspace_root}}, "")
               }
             })

    issue = %{identifier: "DEFAULT-CLONE", project_slug: project_slug}

    assert {:ok, workspace} = Workspace.create_for_issue(issue)
    assert File.read!(Path.join([workspace, "site", "README.md"])) == "canonical seed\n"
    assert File.regular?(Path.join(workspace, @readiness_marker))
  end

  test "issue workspace materializes a root repository configured at dot", %{
    workspace_root: workspace_root
  } do
    project_slug = "provision-root-clone-#{System.unique_integer([:positive])}"
    seed = Path.join(workspace_root, "root-clone-seed")
    bare = Path.join(workspace_root, "root-clone-seed.git")
    create_bare_seed!(seed, bare, "root repository\n")

    assert {:ok, _project} =
             Context.create_workspace_project(%{
               name: "Provision Root Clone",
               slug: project_slug,
               repositories: [
                 %{
                   github_full_name: "local/root-clone",
                   clone_url: bare,
                   default_branch: "main",
                   selected_branch: "main",
                   workspace_path: ".",
                   role: "application"
                 }
               ],
               setup: %{
                 workflow_markdown: Workflow.to_markdown(%{"workspace" => %{"root" => workspace_root}}, "")
               }
             })

    issue = %{identifier: "ROOT-CLONE", project_slug: project_slug}

    assert {:ok, workspace} = Workspace.create_for_issue(issue)
    assert File.read!(Path.join(workspace, "README.md")) == "root repository\n"
    assert File.dir?(Path.join(workspace, ".git"))
    assert File.regular?(Path.join(workspace, @readiness_marker))
  end

  test "configured after_create hook remains the sole repository materializer", %{
    workspace_root: workspace_root
  } do
    project_slug = "provision-hook-clone-#{System.unique_integer([:positive])}"

    assert {:ok, _project} =
             Context.create_workspace_project(%{
               name: "Provision Hook Clone",
               slug: project_slug,
               repositories: [
                 %{
                   github_full_name: "local/hook-owned",
                   clone_url: "/does/not/exist.git",
                   default_branch: "main",
                   selected_branch: "main",
                   workspace_path: "site",
                   role: "application"
                 }
               ]
             })

    workspace = Path.join(workspace_root, "HOOK-CLONE")

    assert {:ok, ^workspace} =
             Provision.ensure(workspace,
               project_slug: project_slug,
               after_create: "mkdir site; printf 'hook owned\\n' > site/README.md"
             )

    assert File.read!(Path.join(workspace, "site/README.md")) == "hook owned\n"
  end

  test "workspace-internal skill links remain valid after staging is renamed", %{
    workspace_root: workspace_root,
    skills_root: skills_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-LINKS")

    configure_workflow!(workspace_root,
      hook_after_create:
        "git init --quiet front; mkdir -p front/.codex; " <>
          "ln -s \"$PWD/.symphony/skills\" front/.codex/skills"
    )

    assert {:ok, ^workspace} = Workspace.ensure_at(workspace, "ATOMIC-LINKS")
    readiness_token = File.read!(Path.join(workspace, @readiness_marker))
    assert readiness_token == File.read!(Path.join(workspace, @ownership_marker))
    assert String.trim(readiness_token) != ""

    for skills_link <- [
          Path.join([workspace, ".codex", "skills"]),
          Path.join([workspace, ".claude", "skills"]),
          Path.join([workspace, "front", ".codex", "skills"]),
          Path.join([workspace, "front", ".claude", "skills"])
        ] do
      assert skills_link |> File.read_link!() |> Path.type() == :relative
      assert File.regular?(Path.join([skills_link, "commit", "SKILL.md"]))
    end

    mirror_link = Path.join([workspace, ".symphony", "skills", "commit"])
    assert File.read_link!(mirror_link) == Path.join(skills_root, "commit")
  end

  test "a preexisting legacy directory is returned without modification", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-LEGACY")
    sentinel = Path.join(workspace, "local-progress.txt")
    temporary_file = Path.join([workspace, "tmp", "scratch.txt"])
    hook_marker = Path.join(workspace_root, "legacy-hook-ran")

    File.mkdir_p!(Path.dirname(temporary_file))
    File.write!(sentinel, "keep\n")
    File.write!(temporary_file, "keep temporary state\n")
    entries_before = workspace |> File.ls!() |> Enum.sort()

    configure_workflow!(workspace_root,
      hook_after_create: "printf 'ran\\n' > #{shell_quote(hook_marker)}"
    )

    assert {:ok, ^workspace} = Workspace.ensure_at(workspace, "ATOMIC-LEGACY")
    assert File.read!(sentinel) == "keep\n"
    assert File.read!(temporary_file) == "keep temporary state\n"
    assert workspace |> File.ls!() |> Enum.sort() == entries_before
    refute File.exists?(hook_marker)
  end

  test "reserved provisioning container basename is never a workspace", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, ".symphony-provisioning")
    sentinel = Path.join(workspace, "do-not-touch.txt")
    File.mkdir_p!(workspace)
    File.write!(sentinel, "reserved\n")

    assert {:error,
            %{
              stage: :validate_input,
              reason: {:reserved_workspace_name, ^workspace},
              retryable: false
            }} = Provision.ensure(workspace, [])

    assert File.read!(sentinel) == "reserved\n"
    assert File.ls!(workspace) == ["do-not-touch.txt"]
  end

  test "a preexisting non-directory final path is never replaced", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-BLOCKED")
    File.write!(workspace, "do not replace\n")

    assert {:error, %{workspace: ^workspace, stage: :inspect_final, retryable: false}} =
             Workspace.ensure_at(workspace, "ATOMIC-BLOCKED")

    assert File.read!(workspace) == "do not replace\n"
  end

  test "a final directory that appears during provisioning is never replaced", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-PUBLISH-RACE")
    configure_workflow!(workspace_root, hook_after_create: "mkdir #{shell_quote(workspace)}")

    assert {:error, %{workspace: ^workspace, stage: :publish, retryable: true}} =
             Workspace.ensure_at(workspace, "ATOMIC-PUBLISH-RACE")

    assert File.dir?(workspace)
    assert File.ls!(workspace) == []
    assert provisioning_container_entries(workspace) == []
  end

  test "injected staging validation runs after skills and blocks publication", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-VALIDATION")
    parent = self()

    validator = fn staging ->
      skill_ready = File.regular?(Path.join([staging, ".codex", "skills", "commit", "SKILL.md"]))
      readiness_written = File.exists?(Path.join(staging, @readiness_marker))
      send(parent, {:validation_state, skill_ready, readiness_written})
      {:error, :rejected_by_validator}
    end

    assert {:error,
            %{
              stage: :validate,
              reason: :rejected_by_validator,
              retryable: true,
              staging: staging
            }} = Provision.ensure(workspace, validator: validator)

    assert_received {:validation_state, true, false}
    refute File.exists?(workspace)
    refute File.exists?(staging)
    assert Path.dirname(staging) == provisioning_container(workspace)
    assert Path.dirname(provisioning_container(workspace)) == Path.dirname(workspace)
  end

  test "ownership marker creation rejects a symlinked controlled parent", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-OWNER-PARENT-SYMLINK")
    external = Path.join(Path.dirname(workspace_root), "external-symphony")
    sentinel = Path.join(external, "sentinel.txt")
    File.mkdir_p!(external)
    File.write!(sentinel, "external\n")

    assert {:error, %{stage: :claim_staging, retryable: true}} =
             Provision.ensure(workspace,
               after_create: "ln -s #{shell_quote(external)} .symphony"
             )

    assert File.read!(sentinel) == "external\n"
    assert File.ls!(external) == ["sentinel.txt"]
    refute File.exists?(workspace)
  end

  test "readiness marker creation never follows an existing symlink", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-READY-SYMLINK")
    external_file = Path.join(Path.dirname(workspace_root), "external-ready.txt")
    File.write!(external_file, "external\n")

    validator = fn staging ->
      File.ln_s!(external_file, Path.join(staging, @readiness_marker))
      :ok
    end

    assert {:error, %{stage: :write_readiness, retryable: true}} =
             Provision.ensure(workspace, validator: validator)

    assert File.read!(external_file) == "external\n"
    refute File.exists?(workspace)
  end

  test "workspace skills reject a symlinked editor root without traversing it", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-EDITOR-SYMLINK")
    external = Path.join(Path.dirname(workspace_root), "external-editor")
    sentinel = Path.join(external, "sentinel.txt")
    editor_root = Path.join(workspace, "front")

    File.mkdir_p!(workspace)
    File.mkdir_p!(external)
    File.write!(sentinel, "external\n")
    File.ln_s!(external, editor_root)

    assert {:error, {:blocked_path, ^editor_root}} = WorkspaceSkills.prepare(workspace)
    assert File.read!(sentinel) == "external\n"
    assert File.ls!(external) == ["sentinel.txt"]
  end

  test "git excludes reject a symlinked info directory without external writes", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-GIT-INFO-SYMLINK")
    repo = Path.join(workspace, "front")
    info = Path.join([repo, ".git", "info"])
    external_info = Path.join(Path.dirname(workspace_root), "external-git-info")
    external_exclude = Path.join(external_info, "exclude")

    File.mkdir_p!(Path.dirname(info))
    File.mkdir_p!(external_info)
    File.write!(external_exclude, "external\n")
    File.ln_s!(external_info, info)

    assert {:error, {:blocked_path, ^info}} = WorkspaceSkills.prepare(workspace)
    assert File.read!(external_exclude) == "external\n"
  end

  test "reserved provisioning container cannot redirect to another filesystem path", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-CONTAINER-SYMLINK")
    container = provisioning_container(workspace)
    outside = Path.join(Path.dirname(workspace_root), "outside-provisioning")

    File.mkdir_p!(outside)
    File.ln_s!(outside, container)

    assert {:error,
            %{
              stage: :create_staging,
              reason: {:provisioning_container_invalid, ^container, :symlink},
              retryable: true
            }} = Provision.ensure(workspace, [])

    assert File.ls!(outside) == []
    refute File.exists?(workspace)
  end

  test "different paths share a concurrently created provisioning container", %{
    workspace_root: workspace_root
  } do
    first_workspace = Path.join(workspace_root, "ATOMIC-CONTAINER-FIRST")
    second_workspace = Path.join(workspace_root, "ATOMIC-CONTAINER-SECOND")
    expected_container = provisioning_container(first_workspace)
    parent = self()

    container_mkdir = fn container ->
      send(parent, {:container_mkdir_ready, self(), container})

      receive do
        :create_container -> File.mkdir(container)
      end
    end

    first =
      Task.async(fn ->
        Provision.ensure(first_workspace, container_mkdir: container_mkdir)
      end)

    second =
      Task.async(fn ->
        Provision.ensure(second_workspace, container_mkdir: container_mkdir)
      end)

    assert_receive {:container_mkdir_ready, first_worker, ^expected_container},
                   @task_timeout_ms

    assert_receive {:container_mkdir_ready, second_worker, ^expected_container},
                   @task_timeout_ms

    send(first_worker, :create_container)
    send(second_worker, :create_container)

    assert {:ok, ^first_workspace} = Task.await(first, @task_timeout_ms)
    assert {:ok, ^second_workspace} = Task.await(second, @task_timeout_ms)
  end

  test "default validation rejects an unusable immediate Git repository", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-BROKEN-GIT")
    configure_workflow!(workspace_root, hook_after_create: "mkdir -p broken/.git")

    assert {:error, %{stage: :validate, retryable: true, staging: staging}} =
             Workspace.ensure_at(workspace, "ATOMIC-BROKEN-GIT")

    refute File.exists?(workspace)
    refute File.exists?(staging)
  end

  test "default validation accepts a usable dirty immediate Git repository", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-DIRTY-GIT")

    configure_workflow!(workspace_root,
      hook_after_create: "git init repo >/dev/null 2>&1; printf 'legitimate hook output\\n' > repo/untracked.txt"
    )

    assert {:ok, ^workspace} = Workspace.ensure_at(workspace, "ATOMIC-DIRTY-GIT")
    assert File.read!(Path.join([workspace, "repo", "untracked.txt"])) == "legitimate hook output\n"
  end

  test "unsupported atomic mover fails before provisioning mutation", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-MOVER-UNSUPPORTED")

    unsupported_runner = fn
      "mv", ["--version"], _options -> {"mv (BusyBox) test\n", 0}
      "mv", _arguments, _options -> {"unexpected move\n", 99}
    end

    assert {:error,
            %{
              stage: :create_staging,
              reason: {:atomic_move_unsupported, "mv", "mv (BusyBox) test"},
              retryable: true
            }} = Provision.ensure(workspace, publish_runner: unsupported_runner)

    refute File.exists?(workspace)
    refute File.exists?(provisioning_container(workspace))
  end

  test "no-clobber publication preserves a final created at the move boundary", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-NO-CLOBBER")
    foreign_file = Path.join(workspace, "foreign.txt")
    parent = self()

    publish_runner =
      gnu_mv_runner(fn command, args, options ->
        source = Enum.at(args, -2)
        source_stat = File.stat!(source)
        parent_stat = File.stat!(Path.dirname(workspace))
        File.mkdir!(workspace)
        File.write!(foreign_file, "foreign\n")
        send(parent, {:publish_command, command, args})

        send(
          parent,
          {:publish_filesystems, {source_stat.major_device, source_stat.minor_device}, {parent_stat.major_device, parent_stat.minor_device}}
        )

        System.cmd(command, args, options)
      end)

    assert {:error, %{stage: :publish, retryable: true, staging: staging}} =
             Provision.ensure(workspace, publish_runner: publish_runner)

    assert_received {:publish_command, "mv", args}
    [source, ^workspace] = Enum.take(args, -2)
    assert Enum.drop(args, -2) in [["--no-clobber", "--no-target-directory"], ["-n"]]
    assert Path.dirname(Path.dirname(source)) == provisioning_container(workspace)
    assert_received {:publish_filesystems, device, device}
    assert File.read!(foreign_file) == "foreign\n"
    refute File.exists?(Path.join(workspace, @readiness_marker))
    refute File.exists?(staging)
  end

  test "BSD no-clobber publication cleans its payload from a final created at the move boundary", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-BSD-NO-CLOBBER")
    foreign_file = Path.join(workspace, "foreign.txt")
    parent = self()

    publish_runner =
      bsd_mv_runner(fn command, args, options ->
        if List.last(args) == workspace do
          File.mkdir!(workspace)
          File.write!(foreign_file, "foreign\n")
          send(parent, {:publish_command, command, args})
        end

        System.cmd(command, args, options)
      end)

    assert {:error, %{stage: :publish, retryable: true, staging: staging}} =
             Provision.ensure(workspace, publish_runner: publish_runner)

    assert_received {:publish_command, "mv", ["-n", source, ^workspace]}
    assert Path.dirname(Path.dirname(source)) == provisioning_container(workspace)
    assert File.read!(foreign_file) == "foreign\n"
    refute File.exists?(Path.join(workspace, "workspace"))
    refute File.exists?(staging)
  end

  test "publish rolls back an owned final when readiness disappears at the boundary", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-READINESS-RACE")

    publish_runner =
      gnu_mv_runner(fn command, args, options ->
        result = System.cmd(command, args, options)
        File.rm!(Path.join(workspace, @readiness_marker))
        result
      end)

    assert {:error,
            %{
              stage: :publish,
              reason: {:workspace_incomplete, ^workspace, _verification_error, :rolled_back},
              retryable: true
            }} = Provision.ensure(workspace, publish_runner: publish_runner)

    refute File.exists?(workspace)
    assert {:ok, ^workspace} = Provision.ensure(workspace, [])
  end

  test "an owned final without readiness is incomplete rather than legacy", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-INCOMPLETE")
    token = "persisted-owner-token"

    File.mkdir_p!(Path.join(workspace, ".symphony"))
    File.write!(Path.join(workspace, @ownership_marker), token <> "\n")
    File.write!(Path.join(workspace, "partial.txt"), "partial\n")

    assert {:error,
            %{
              stage: :inspect_final,
              reason: {:workspace_incomplete, ^workspace, _verification_error, :rolled_back},
              retryable: true
            }} = Provision.ensure(workspace, [])

    refute File.exists?(workspace)
    assert {:ok, ^workspace} = Provision.ensure(workspace, [])
  end

  test "same-process same-path reentry fails explicitly without deadlocking", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-REENTRY")
    parent = self()

    validator = fn _staging ->
      reentry_result = Provision.ensure(workspace, [])
      send(parent, {:reentry_result, reentry_result})

      case reentry_result do
        {:error,
         %{
           stage: :lock,
           reason: {:reentrant_provision, ^workspace},
           retryable: true
         }} ->
          :ok

        other ->
          {:error, {:unexpected_reentry_result, other}}
      end
    end

    task = Task.async(fn -> Provision.ensure(workspace, validator: validator) end)

    assert {:ok, ^workspace} = Task.await(task, @task_timeout_ms)

    assert_received {:reentry_result,
                     {:error,
                      %{
                        stage: :lock,
                        reason: {:reentrant_provision, ^workspace},
                        retryable: true
                      }}}
  end

  test "single-flight registry releases waiters when worker dies", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-OWNER-DOWN")
    parent = self()

    validator = fn staging ->
      send(parent, {:worker_registered, self(), staging})

      receive do
        :finish_validation -> :ok
      end
    end

    caller = Task.async(fn -> Provision.ensure(workspace, validator: validator) end)
    assert_receive {:worker_registered, worker, staging}, @task_timeout_ms
    attempt_root = Path.dirname(staging)
    task_supervisor = Process.whereis(SymphonyElixir.TaskSupervisor)
    assert {:links, links} = Process.info(worker, :links)
    assert task_supervisor in links
    waiter = Task.async(fn -> Provision.ensure(workspace, []) end)
    assert Task.yield(waiter, @short_wait_ms) == nil

    Process.unlink(caller.pid)
    worker_monitor = Process.monitor(worker)
    Process.exit(worker, :kill)
    assert_receive {:DOWN, ^worker_monitor, :process, ^worker, :killed}, @task_timeout_ms

    caller_observation =
      Task.yield(caller, @task_timeout_ms) || Task.shutdown(caller, :brutal_kill)

    waiter_observation =
      Task.yield(waiter, @task_timeout_ms) || Task.shutdown(waiter, :brutal_kill)

    assert {:ok, ^workspace} = Provision.ensure(workspace, [])

    assert {:ok,
            {:error,
             %{
               staging: ^attempt_root,
               stage: :validate,
               reason: {:workspace_provision_worker_down, ^workspace, :killed},
               cleanup_error: nil,
               retryable: true
             }}} = caller_observation

    assert waiter_observation == caller_observation
    refute File.exists?(attempt_root)
  end

  test "worker-death cleanup quarantines and preserves a foreign substitute", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-WORKER-DOWN-FOREIGN")
    parent = self()

    validator = fn staging ->
      File.rm_rf!(staging)
      File.mkdir_p!(Path.join(staging, ".symphony"))
      File.write!(Path.join(staging, @ownership_marker), "foreign-token\n")
      File.write!(Path.join(staging, "foreign.txt"), "foreign\n")
      send(parent, {:foreign_worker_registered, self(), staging})

      receive do
        :finish_validation -> :ok
      end
    end

    caller = Task.async(fn -> Provision.ensure(workspace, validator: validator) end)
    assert_receive {:foreign_worker_registered, worker, staging}, @task_timeout_ms
    attempt_root = Path.dirname(staging)

    Process.unlink(caller.pid)
    worker_monitor = Process.monitor(worker)
    Process.exit(worker, :kill)
    assert_receive {:DOWN, ^worker_monitor, :process, ^worker, :killed}, @task_timeout_ms

    caller_observation =
      Task.yield(caller, @task_timeout_ms) || Task.shutdown(caller, :brutal_kill)

    assert {:ok,
            {:error,
             %{
               staging: ^attempt_root,
               stage: :validate,
               reason: {:workspace_provision_worker_down, ^workspace, :killed},
               cleanup_error: {:quarantine_ownership_mismatch, quarantine, _ownership_error},
               retryable: true
             }}} = caller_observation

    refute File.exists?(attempt_root)
    assert File.read!(Path.join([quarantine, "workspace", "foreign.txt"])) == "foreign\n"
    refute File.exists?(workspace)
  end

  test "worker DOWN returns success when owned final was already published", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-WORKER-DOWN-PUBLISHED")
    parent = self()

    publish_runner =
      gnu_mv_runner(fn command, args, options ->
        result = System.cmd(command, args, options)
        send(parent, {:published_worker_blocked, self()})

        receive do
          :return_publish_result -> result
        end
      end)

    caller =
      Task.async(fn ->
        Provision.ensure(workspace, publish_runner: publish_runner)
      end)

    assert_receive {:published_worker_blocked, worker}, @task_timeout_ms
    waiter = Task.async(fn -> Provision.ensure(workspace, []) end)
    assert Task.yield(waiter, @short_wait_ms) == nil

    Process.unlink(caller.pid)
    worker_monitor = Process.monitor(worker)
    Process.exit(worker, :kill)
    assert_receive {:DOWN, ^worker_monitor, :process, ^worker, :killed}, @task_timeout_ms

    caller_result = Task.await(caller, @task_timeout_ms)
    waiter_result = Task.await(waiter, @task_timeout_ms)

    assert caller_result == {:ok, workspace}
    assert waiter_result == caller_result
    assert File.regular?(Path.join(workspace, @ownership_marker))
    assert File.regular?(Path.join(workspace, @readiness_marker))
    assert provisioning_container_entries(workspace) == []
  end

  test "cleanup quarantines a replacement and never deletes it", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-OWNERSHIP")
    parent = self()

    validator = fn staging ->
      send(parent, {:validator_staging, staging})
      File.rm_rf!(staging)
      File.mkdir_p!(staging)
      File.mkdir_p!(Path.join(staging, ".symphony"))
      File.write!(Path.join(staging, @ownership_marker), "foreign-token\n")
      File.write!(Path.join(staging, "foreign.txt"), "foreign\n")
      {:error, :forced_validation_failure}
    end

    assert {:error,
            %{
              stage: :validate,
              reason: :forced_validation_failure,
              retryable: true,
              staging: staging,
              cleanup_error: {:quarantine_ownership_mismatch, quarantine, _ownership_error}
            }} = Provision.ensure(workspace, validator: validator)

    assert_received {:validator_staging, payload}
    assert payload == Path.join(staging, "workspace")
    refute File.exists?(staging)
    assert File.read!(Path.join([quarantine, "workspace", "foreign.txt"])) == "foreign\n"
    refute File.exists?(workspace)
  end

  test "cleanup preserves quarantine when the payload token does not match", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-TOKEN-MISMATCH")

    validator = fn staging ->
      File.write!(Path.join(staging, @ownership_marker), "foreign-token\n")
      File.write!(Path.join(staging, "foreign.txt"), "foreign\n")
      {:error, :forced_token_mismatch}
    end

    assert {:error,
            %{
              stage: :validate,
              reason: :forced_token_mismatch,
              cleanup_error: {:quarantine_ownership_mismatch, quarantine, :payload_token_mismatch}
            }} = Provision.ensure(workspace, validator: validator)

    assert File.read!(Path.join([quarantine, "workspace", "foreign.txt"])) == "foreign\n"
    refute File.exists?(workspace)
  end

  test "workspace inventory hides only the reserved provisioning container" do
    project_slug = "provision-inventory-#{System.unique_integer([:positive])}"
    project_name = String.upcase(project_slug)

    assert {:ok, _project} =
             Context.ensure_project(%{
               name: project_name,
               slug: project_slug,
               tracker_kind: "local"
             })

    layout = Workspace.project_layout(project_slug)
    segment_root = Path.join(layout.root, layout.segment)
    workspace = Path.join(segment_root, "foo.provisioning-bar")
    container = Path.join(segment_root, ".symphony-provisioning")
    staging = Path.join(container, "foo.provisioning-bar-test-token")

    repo = Path.join(workspace, "repo")
    File.mkdir_p!(repo)
    File.mkdir_p!(staging)
    assert {"", 0} = System.cmd("git", ["init", "--quiet", repo], stderr_to_stdout: true)
    assert {"", 0} = System.cmd("git", ["init", "--quiet", staging], stderr_to_stdout: true)

    assert {:ok, scan} =
             Inventory.scan(project_slug,
               executions: [],
               max_concurrency: 1,
               size_fun: fn _path -> 1 end
             )

    paths = Enum.map(scan.workspaces, & &1.path)
    repo_paths = Enum.flat_map(scan.workspaces, fn entry -> Enum.map(entry.repos, & &1.path) end)
    assert workspace in paths
    refute container in paths
    refute Enum.any?(repo_paths, &String.starts_with?(&1, container <> "/"))
  end

  test "skills preparation rewrites an absolute managed mirror link as relative", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-MANAGED-LINK")
    mirror = Path.join([workspace, ".symphony", "skills"])
    skills_link = Path.join([workspace, ".codex", "skills"])

    File.mkdir_p!(mirror)
    File.mkdir_p!(Path.dirname(skills_link))
    File.ln_s!(mirror, skills_link)

    assert :ok = WorkspaceSkills.prepare(workspace)
    assert skills_link |> File.read_link!() |> Path.type() == :relative
    assert File.regular?(Path.join([skills_link, "commit", "SKILL.md"]))
  end

  test "skills preparation preserves a custom top-level skills target", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-CUSTOM-TARGET")
    custom_skills = Path.join(workspace_root, "custom-skills-target")
    skills_link = Path.join([workspace, ".codex", "skills"])

    File.mkdir_p!(custom_skills)
    File.mkdir_p!(Path.dirname(skills_link))
    File.ln_s!(custom_skills, skills_link)

    assert :ok = WorkspaceSkills.prepare(workspace)
    assert File.read_link!(skills_link) == custom_skills
  end

  test "existing skills directory rewrites an absolute managed entry as relative", %{
    workspace_root: workspace_root,
    skills_root: skills_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-MANAGED-SKILL-ENTRY")
    mirror = Path.join([workspace, ".symphony", "skills"])
    mirror_entry = Path.join(mirror, "commit")
    existing_skills = Path.join([workspace, ".codex", "skills"])
    managed_entry = Path.join(existing_skills, "commit")

    File.mkdir_p!(mirror)
    File.mkdir_p!(existing_skills)
    File.ln_s!(Path.join(skills_root, "commit"), mirror_entry)
    File.ln_s!(mirror_entry, managed_entry)

    assert :ok = WorkspaceSkills.prepare(workspace)
    assert managed_entry |> File.read_link!() |> Path.type() == :relative
    assert File.regular?(Path.join([managed_entry, "SKILL.md"]))
  end

  test "skills preparation preserves custom entries in an existing skills directory", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-CUSTOM-SKILL")
    existing_skills = Path.join([workspace, ".codex", "skills"])
    custom_skill = Path.join(workspace_root, "custom-commit-skill")
    custom_link = Path.join(existing_skills, "commit")

    File.mkdir_p!(existing_skills)
    File.mkdir_p!(custom_skill)
    File.write!(Path.join(custom_skill, "SKILL.md"), "# Custom commit\n")
    File.ln_s!(custom_skill, custom_link)

    assert :ok = WorkspaceSkills.prepare(workspace)
    assert File.read_link!(custom_link) == custom_skill
    assert File.read!(Path.join([custom_link, "SKILL.md"])) == "# Custom commit\n"
  end

  test "skill pruning preserves a custom authoring-name directory", %{
    workspace_root: workspace_root
  } do
    workspace = Path.join(workspace_root, "ATOMIC-CUSTOM-AUTHORING")
    custom_authoring = Path.join([workspace, ".codex", "skills", "brainstorming"])
    custom_file = Path.join(custom_authoring, "CUSTOM.md")

    File.mkdir_p!(custom_authoring)
    File.write!(custom_file, "custom\n")

    assert :ok = WorkspaceSkills.prepare(workspace)
    assert File.read!(custom_file) == "custom\n"
  end

  defp configure_workflow!(workspace_root, overrides \\ []) do
    options = Keyword.merge([workspace_root: workspace_root], overrides)
    write_workflow_file!(Workflow.workflow_file_path(), options)
  end

  defp write_skill!(skills_root, name) do
    skill_dir = Path.join(skills_root, name)
    File.mkdir_p!(skill_dir)
    File.write!(Path.join(skill_dir, "SKILL.md"), "# #{name}\n")
  end

  defp create_bare_seed!(seed, bare, content) do
    File.mkdir_p!(seed)
    assert {"", 0} = System.cmd("git", ["init", "--quiet", "--initial-branch=main"], cd: seed)
    File.write!(Path.join(seed, "README.md"), content)
    assert {"", 0} = System.cmd("git", ["add", "README.md"], cd: seed)

    assert {_output, 0} =
             System.cmd(
               "git",
               [
                 "-c",
                 "user.name=Symphony Test",
                 "-c",
                 "user.email=symphony-test@example.com",
                 "commit",
                 "--quiet",
                 "-m",
                 "seed"
               ],
               cd: seed
             )

    assert {_output, 0} = System.cmd("git", ["clone", "--quiet", "--bare", seed, bare])
  end

  defp shell_quote(value) do
    "'" <> String.replace(value, "'", "'\"'\"'") <> "'"
  end

  defp provisioning_container(workspace) do
    Path.join(Path.dirname(workspace), ".symphony-provisioning")
  end

  defp provisioning_container_entries(workspace) do
    case workspace |> provisioning_container() |> File.ls() do
      {:ok, entries} -> Enum.sort(entries)
      {:error, :enoent} -> []
    end
  end

  defp await_task_observation(task, nil), do: Task.await(task, @task_timeout_ms)
  defp await_task_observation(_task, {:ok, result}), do: result
  defp await_task_observation(_task, {:exit, reason}), do: flunk("task exited: #{inspect(reason)}")

  defp gnu_mv_runner(move_callback) do
    fn
      "mv", ["--version"], options ->
        System.cmd("mv", ["--version"], options)

      command, arguments, options ->
        move_callback.(command, arguments, options)
    end
  end

  defp bsd_mv_runner(move_callback) do
    fn
      "mv", ["--version"], _options ->
        {"mv: illegal option -- -\nusage: mv [-f | -i | -n] source target\n", 64}

      command, arguments, options ->
        move_callback.(command, arguments, options)
    end
  end

  defp restore_skills_root(nil), do: Application.delete_env(:symphony_elixir, :skills_root)
  defp restore_skills_root(value), do: Application.put_env(:symphony_elixir, :skills_root, value)
end
