import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "test-results"]);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function filesBelow(root, current = root) {
  if (!(await exists(current))) return [];
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(root, path)));
    else if (entry.isFile()) files.push(path.slice(root.length + 1));
  }
  return files;
}

async function hasE2eTests(workspacePath) {
  const root = join(workspacePath, "tests", "e2e");
  return (await filesBelow(root)).some((path) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(path));
}

export async function inspectWorkspace(workspacePath) {
  if (!(await exists(workspacePath))) {
    return {
      exists: false,
      file_count: 0,
      contract: {
        package_json: false,
        source: false,
        playwright_config: false,
        e2e_tests: false,
        scripts: { dev: false, build: false, test_e2e: false },
      },
    };
  }

  const packagePath = join(workspacePath, "package.json");
  let packageJson = null;
  try {
    packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  } catch {
    packageJson = null;
  }
  const scripts = packageJson?.scripts ?? {};
  const files = await filesBelow(workspacePath);
  const source = files.some((path) => /^src\/.+\.[cm]?[jt]sx?$/.test(path));
  const playwrightConfig = files.some((path) =>
    /^playwright\.config\.[cm]?[jt]s$/.test(path),
  );

  return {
    exists: true,
    file_count: files.length,
    contract: {
      package_json: packageJson !== null,
      source,
      playwright_config: playwrightConfig,
      e2e_tests: await hasE2eTests(workspacePath),
      scripts: {
        dev: typeof scripts.dev === "string",
        build: typeof scripts.build === "string",
        test_e2e: typeof scripts["test:e2e"] === "string",
      },
    },
  };
}

function contractPassed(contract) {
  return (
    contract.package_json &&
    contract.source &&
    contract.playwright_config &&
    contract.e2e_tests &&
    Object.values(contract.scripts).every(Boolean)
  );
}

async function executeValidation(command, args, cwd, timeout) {
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    return {
      command: [command, ...args].join(" "),
      status: "passed",
      exit_code: 0,
      duration_ms: Date.now() - startedAt,
      output: `${stdout}${stderr}`.slice(-20_000),
    };
  } catch (error) {
    return {
      command: [command, ...args].join(" "),
      status: error?.killed ? "timed_out" : "failed",
      exit_code: Number.isInteger(error?.code) ? error.code : null,
      duration_ms: Date.now() - startedAt,
      output: `${error?.stdout ?? ""}${error?.stderr ?? ""}`.slice(-20_000),
      error: error?.message ?? String(error),
    };
  }
}

async function validateWorkspace(workspacePath) {
  const steps = [];
  const commands = [
    ["npm", ["install"], 8 * 60 * 1000],
    ["npm", ["run", "build"], 5 * 60 * 1000],
    ["npm", ["run", "test:e2e"], 10 * 60 * 1000],
  ];

  for (const [command, args, timeout] of commands) {
    const result = await executeValidation(command, args, workspacePath, timeout);
    steps.push(result);
    if (result.status !== "passed") break;
  }
  return steps;
}

export function renderComparison({ prompt_sha256: promptHash, rows }) {
  const lines = [
    "# Comparação de agentes — landing page Symphony",
    "",
    `Prompt SHA-256: \`${promptHash}\``,
    "",
    "| Célula | Caminho | Provedor | Symphony | Contrato | Build/E2E | Duração |",
    "| --- | --- | --- | --- | --- | --- | ---: |",
  ];

  for (const row of rows) {
    const validation =
      row.validation?.length > 0 &&
      row.validation.every((step) => step.status === "passed")
        ? "passed"
        : row.validation?.at(-1)?.status ?? "not-run";
    lines.push(
      `| ${row.id} | ${row.path} | ${row.provider} | ${row.status} | ${row.contract_passed ? "passed" : "failed"} | ${validation} | ${row.duration_ms ?? 0} ms |`,
    );
  }

  lines.push(
    "",
    "## Saídas",
    "",
    ...rows.flatMap((row) => [
      `### ${row.id}`,
      "",
      `- Workspace: \`${row.workspace_path}\``,
      `- Arquivos gerados: ${row.file_count ?? 0}`,
      `- Artefatos Symphony: \`${row.artifact_root ?? "indisponível"}\``,
      `- Erro: ${row.error ? `\`${String(row.error).split("\n")[0]}\`` : "nenhum registrado"}`,
      "",
    ]),
    "## Revisão visual humana",
    "",
    "Avaliar lado a lado hierarquia visual, qualidade da cópia, responsividade e manutenção. O coletor não inventa uma nota estética.",
    "",
  );
  return lines.join("\n");
}

function workspaceForRun(manifest, run) {
  if (run.path === "session") return join(run.workspace_path, "site");
  const safeIdentifier = run.issue_identifier.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(
    manifest.runtime_root,
    "workspaces",
    manifest.project_slug,
    safeIdentifier,
    "site",
  );
}

export async function collect(env = process.env) {
  const runtimeRoot = resolve(env.SYMPHONY_BENCH_RUNTIME ?? "");
  if (!env.SYMPHONY_BENCH_RUNTIME?.trim()) {
    throw new Error("SYMPHONY_BENCH_RUNTIME is required");
  }
  const manifest = JSON.parse(await readFile(join(runtimeRoot, "runs.json"), "utf8"));
  const rows = [];

  for (const run of manifest.runs) {
    const workspacePath = workspaceForRun(manifest, run);
    const facts = await inspectWorkspace(workspacePath);
    let runResult = {};
    try {
      runResult = JSON.parse(
        await readFile(join(runtimeRoot, "results", `${run.id}.json`), "utf8"),
      );
    } catch {
      runResult = { status: "not-run", error: "run result is missing" };
    }

    const validation =
      facts.exists && contractPassed(facts.contract)
        ? await validateWorkspace(workspacePath)
        : [];
    const row = {
      ...run,
      ...runResult,
      workspace_path: workspacePath,
      file_count: facts.file_count,
      contract: facts.contract,
      contract_passed: contractPassed(facts.contract),
      validation,
    };
    rows.push(row);
    await writeFile(
      join(runtimeRoot, "results", `${run.id}-collected.json`),
      `${JSON.stringify(row, null, 2)}\n`,
    );
  }

  const comparison = {
    generated_at: new Date().toISOString(),
    prompt_sha256: manifest.prompt_sha256,
    rows,
  };
  await mkdir(join(runtimeRoot, "report"), { recursive: true });
  await writeFile(
    join(runtimeRoot, "report", "comparison.json"),
    `${JSON.stringify(comparison, null, 2)}\n`,
  );
  await writeFile(
    join(runtimeRoot, "report", "comparison.md"),
    renderComparison(comparison),
  );
  return comparison;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  collect()
    .then((comparison) => {
      process.stdout.write(
        `${JSON.stringify({
          prompt_sha256: comparison.prompt_sha256,
          rows: comparison.rows.map((row) => ({
            id: row.id,
            status: row.status,
            contract_passed: row.contract_passed,
            validation: row.validation.map((step) => step.status),
          })),
        }, null, 2)}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
