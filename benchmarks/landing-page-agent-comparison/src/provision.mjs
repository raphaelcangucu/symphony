import { execFile } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createApi } from "./api.mjs";
import {
  RUN_MATRIX,
  promptSha256,
  readCanonicalPrompt,
} from "./contract.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PROJECT_SLUG = "symphony-landing-benchmark";

const WORKFLOW_STATUSES = Object.freeze([
  { name: "Backlog", category: "backlog", position: 0, is_terminal: false },
  { name: "In Progress", category: "active", position: 1, is_terminal: false },
  { name: "Human Review", category: "wait", position: 2, is_terminal: false },
  { name: "Done", category: "terminal", position: 3, is_terminal: true },
]);

export function workflowMarkdown(workspaceRoot) {
  return `---
tracker:
  field_states:
    - Backlog
    - In Progress
    - Human Review
    - Done
  active_states:
    - In Progress
  dispatch_states:
    - In Progress
  wait_states:
    - Human Review
  terminal_states:
    - Done
workspace:
  root: ${JSON.stringify(workspaceRoot)}
dev_server:
  enabled: true
  runtime_contract_v1: true
  max_concurrent: 1
  idle_timeout_ms: 1800000
  auto_start_on: []
evidence:
  required: true
  repos:
    site:
      unit_command: npm run build
      ui_paths:
        - src/**
      e2e:
        command: npm run test:e2e
agent:
  kind: codex
  max_concurrent_agents: 1
  max_turns: 30
  completion_transitions:
    In Progress: Human Review
codex:
  approval_policy: never
  thread_sandbox: danger-full-access
---
{{ issue.description }}`;
}

export function projectPayload({
  seedBarePath,
  seedWorkingPath,
  workspaceRoot,
}) {
  return {
    name: "Symphony Landing Benchmark",
    slug: PROJECT_SLUG,
    description:
      "Comparação local e isolada entre sessões e orquestrador usando Codex, Cursor e Claude.",
    workflow_statuses: WORKFLOW_STATUSES,
    repositories: [
      {
        github_full_name: "local/symphony-landing-benchmark",
        clone_url: seedBarePath,
        default_branch: "main",
        selected_branch: "main",
        local_path: seedWorkingPath,
        workspace_path: "site",
        role: "application",
        scan_summary: {
          stack: ["react", "typescript", "vite", "playwright"],
          validation_commands: ["npm run build", "npm run test:e2e"],
        },
      },
    ],
    setup: {
      workflow_markdown: workflowMarkdown(workspaceRoot),
      validation_commands: ["cd site && npm run build", "cd site && npm run test:e2e"],
      scan_summary: {
        benchmark: "landing-page-agent-comparison",
      },
    },
    tracker: {
      kind: "local",
      config: {},
    },
  };
}

export function buildRunRecords(prompt) {
  const hash = promptSha256(prompt);

  return RUN_MATRIX.map((run) => ({
    ...run,
    prompt_sha256: hash,
    execution_mode: "yolo",
    status: "provisioned",
    thread_id: null,
    issue_identifier: null,
    workspace_path: null,
  }));
}

async function git(args, cwd) {
  await execFileAsync("git", args, { cwd });
}

async function createSeedRepository(runtimeRoot) {
  const seedWorkingPath = join(runtimeRoot, "seed");
  const seedBarePath = join(runtimeRoot, "seed.git");

  await cp(join(packageRoot, "seed"), seedWorkingPath, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  await git(["init", "-b", "main"], seedWorkingPath);
  await git(["add", "."], seedWorkingPath);
  await git(
    [
      "-c",
      "user.name=Symphony Benchmark",
      "-c",
      "user.email=benchmark@symphony.local",
      "commit",
      "-m",
      "chore: initialize landing benchmark",
    ],
    seedWorkingPath,
  );
  await git(["clone", "--bare", seedWorkingPath, seedBarePath], runtimeRoot);

  return { seedWorkingPath, seedBarePath };
}

function requireEnvironment(env) {
  const baseUrl = env.SYMPHONY_BENCH_URL?.trim();
  const token = env.SYMPHONY_BENCH_TOKEN?.trim();
  const runtimeRoot = env.SYMPHONY_BENCH_RUNTIME?.trim();

  if (!baseUrl || !token || !runtimeRoot) {
    throw new Error(
      "SYMPHONY_BENCH_URL, SYMPHONY_BENCH_TOKEN and SYMPHONY_BENCH_RUNTIME are required",
    );
  }

  return {
    baseUrl,
    token,
    runtimeRoot: resolve(runtimeRoot),
  };
}

export function devEnvironmentSteps() {
  return [
    {
      description: "Symphony landing preview",
      command: `sh -c 'npm run dev -- --host 0.0.0.0 --port "$PORT"'`,
      working_dir: "site",
      source: "convention",
      role: "serve",
      port_env: "PORT",
      url_path: "/",
      ready_probe: "http",
      ready_path: "/",
      primary: true,
      optional: false,
    },
  ];
}

async function saveDevEnvironment(api) {
  await api.request(`/projects/${PROJECT_SLUG}/dev_env/steps`, {
    method: "PUT",
    body: { steps: devEnvironmentSteps() },
  });
}

export async function provisionSessions(api, records) {
  for (const record of records.filter((run) => run.path === "session")) {
    const created = await api.request("/assistant/threads", {
      method: "POST",
      body: {
        scope: "issue_session",
        project_slug: PROJECT_SLUG,
        issue_identifier: record.issue_identifier,
        title: `Landing benchmark · session · ${record.provider}`,
        agent_kind: record.provider,
        execution_mode: record.execution_mode,
        isolated_workspace: true,
      },
    });

    record.thread_id = created.id;
    const provisioned = await api.request(
      `/assistant/threads/${created.id}/workspace/provision`,
      {
        method: "POST",
      },
    );
    record.workspace_path = provisioned.workspace_path;
  }
}

export function issueTitle(record) {
  return `Landing benchmark · ${record.path} · ${record.provider}`;
}

async function provisionIssues(api, records) {
  const prompt = await readCanonicalPrompt();

  for (const record of records) {
    const issue = await api.request(`/projects/${PROJECT_SLUG}/issues`, {
      method: "POST",
      body: {
        title: issueTitle(record),
        description: prompt,
        status: "Backlog",
        agent: record.provider,
      },
    });

    record.issue_identifier = issue.identifier;
  }
}

export async function provision(env = process.env) {
  const { baseUrl, token, runtimeRoot } = requireEnvironment(env);
  const runsPath = join(runtimeRoot, "runs.json");

  try {
    await readFile(runsPath, "utf8");
    throw new Error(`benchmark runtime already provisioned: ${runsPath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(join(runtimeRoot, "results"), { recursive: true });
  await mkdir(join(runtimeRoot, "artifacts"), { recursive: true });

  const { seedWorkingPath, seedBarePath } =
    await createSeedRepository(runtimeRoot);
  const workspaceRoot = join(runtimeRoot, "workspaces");
  const api = createApi({ baseUrl, token });

  await api.request("/projects/workspace", {
    method: "POST",
    body: projectPayload({
      seedBarePath,
      seedWorkingPath,
      workspaceRoot,
    }),
  });
  await saveDevEnvironment(api);

  const prompt = await readCanonicalPrompt();
  const records = buildRunRecords(prompt);
  await provisionIssues(api, records);
  await provisionSessions(api, records);

  const manifest = {
    project_slug: PROJECT_SLUG,
    prompt_sha256: promptSha256(prompt),
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    runtime_root: runtimeRoot,
    runs: records,
  };

  await writeFile(runsPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });

  return manifest;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  provision()
    .then((manifest) => {
      process.stdout.write(
        `${JSON.stringify({
          project_slug: manifest.project_slug,
          prompt_sha256: manifest.prompt_sha256,
          runs: manifest.runs.map((run) => ({
            id: run.id,
            thread_id: run.thread_id,
            issue_identifier: run.issue_identifier,
            workspace_path: run.workspace_path,
          })),
        }, null, 2)}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
