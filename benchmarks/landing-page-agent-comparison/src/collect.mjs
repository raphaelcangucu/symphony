import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { executeProcess } from "./process.mjs";
import { sanitizedChildEnv } from "../seed/scripts/child-env.mjs";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "test-results",
]);

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
  return (await filesBelow(root)).some((path) =>
    /\.(spec|test)\.[cm]?[jt]sx?$/.test(path),
  );
}

export async function gitFacts(workspacePath) {
  const rootResult = await executeProcess(
    "git",
    ["-C", workspacePath, "rev-parse", "--show-toplevel"],
    { cwd: workspacePath, timeout: 10_000 },
  );
  if (rootResult.status !== "passed") {
    return {
      available: false,
      reason: "workspace is not a Git working tree",
      root: null,
      head_sha: null,
      clean: null,
      changed_files: null,
      changed_lines: null,
    };
  }

  const root = rootResult.output.trim().split("\n").at(-1);
  const [head, status, numstat, untracked] = await Promise.all([
    executeProcess("git", ["-C", root, "rev-parse", "HEAD"], {
      cwd: root,
      timeout: 10_000,
    }),
    executeProcess("git", ["-C", root, "status", "--porcelain=v1", "-uall"], {
      cwd: root,
      timeout: 10_000,
    }),
    executeProcess("git", ["-C", root, "diff", "--numstat", "HEAD"], {
      cwd: root,
      timeout: 10_000,
    }),
    executeProcess(
      "git",
      ["-C", root, "ls-files", "--others", "--exclude-standard"],
      { cwd: root, timeout: 10_000 },
    ),
  ]);
  const failedFact = [head, status, numstat, untracked].find(
    (result) => result.status !== "passed",
  );
  if (failedFact) {
    return {
      available: false,
      reason: `Git fact command failed: ${failedFact.command}`,
      root,
      head_sha: null,
      clean: null,
      changed_files: null,
      changed_lines: null,
    };
  }
  const statusLines = status.output.split("\n").filter(Boolean);
  const trackedLines = numstat.output
    .split("\n")
    .filter(Boolean)
    .reduce((sum, line) => {
      const [added, deleted] = line.split("\t");
      return (
        sum +
        (Number.isFinite(Number(added)) ? Number(added) : 0) +
        (Number.isFinite(Number(deleted)) ? Number(deleted) : 0)
      );
    }, 0);
  let untrackedLines = 0;
  for (const relativePath of untracked.output.split("\n").filter(Boolean)) {
    try {
      const content = await readFile(join(root, relativePath), "utf8");
      untrackedLines += content
        ? content.split(/\r?\n/).length - (content.endsWith("\n") ? 1 : 0)
        : 0;
    } catch {
      // Binary and transient files still count as changed files, not text lines.
    }
  }

  return {
    available: true,
    reason: null,
    root,
    head_sha: head.output.trim(),
    clean: statusLines.length === 0,
    changed_files: statusLines.length,
    changed_lines: trackedLines + untrackedLines,
  };
}

export async function inventoryArtifacts(locations) {
  const inventory = { screenshots: [], videos: [], traces: [] };
  for (const location of locations) {
    if (!location?.root || !(await exists(location.root))) continue;
    for (const relativePath of await filesBelow(location.root)) {
      const item = {
        source: location.source,
        path: join(location.root, relativePath),
      };
      if (/\.png$/i.test(relativePath)) inventory.screenshots.push(item);
      else if (/\.(webm|mp4)$/i.test(relativePath)) inventory.videos.push(item);
      else if (/\.zip$/i.test(relativePath)) inventory.traces.push(item);
    }
  }
  for (const values of Object.values(inventory)) {
    values.sort((left, right) => left.path.localeCompare(right.path));
  }
  return inventory;
}

export function summarizeAttempts(attempts, canonicalAttemptId = null) {
  return {
    count: attempts.length,
    canonical_attempt_id: canonicalAttemptId,
    attempt_ids: attempts
      .map((attempt) => attempt?.attempt_id)
      .filter(Boolean)
      .sort(),
  };
}

export function resolveRunIdentity(run, runResult) {
  if (runResult?.identity) {
    return { ...runResult.identity, source: "tracker_snapshot" };
  }
  if (run?.path === "session" && run.thread_id != null) {
    return {
      assistant_thread_id: run.thread_id,
      agent_kind: run.provider,
      status: null,
      provider_matches: null,
      requested_model: run.requested_model ?? null,
      requested_effort: run.requested_effort ?? null,
      resolved_model: null,
      resolved_effort: null,
      source: "manifest",
    };
  }
  return null;
}

export function observedExecutionDuration(runResult) {
  const executionStartedAt = Date.parse(
    runResult?.identity?.agent_execution_started_at ?? "",
  );
  const executionLastEventAt = Date.parse(
    runResult?.identity?.agent_execution_last_event_at ?? "",
  );
  const observedExecutionDuration =
    Number.isFinite(executionStartedAt) &&
    Number.isFinite(executionLastEventAt) &&
    executionLastEventAt >= executionStartedAt
      ? executionLastEventAt - executionStartedAt
      : null;
  const candidates = [
    observedExecutionDuration,
    Number.isFinite(runResult?.identity?.agent_execution_runtime_seconds)
      ? runResult.identity.agent_execution_runtime_seconds * 1_000
      : null,
  ].filter(Number.isFinite);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

async function readAttemptResults(runtimeRoot, runId) {
  const root = join(runtimeRoot, "results", "attempts", runId);
  if (!(await exists(root))) return [];
  const attempts = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      attempts.push(JSON.parse(await readFile(join(root, entry.name), "utf8")));
    } catch {
      // A malformed attempt is omitted from metrics but remains on disk for audit.
    }
  }
  return attempts;
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
  const e2eScript = scripts["test:e2e"];
  const runnerPath = "scripts/run-e2e.mjs";
  let safeE2eRunner = false;
  if (e2eScript === `node ${runnerPath}` && files.includes(runnerPath)) {
    const runner = await readFile(join(workspacePath, runnerPath), "utf8");
    safeE2eRunner =
      runner.includes("--strictPort") && runner.includes("AbortController");
  }

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
        test_e2e: e2eScript === `node ${runnerPath}`,
        e2e_runner: safeE2eRunner,
      },
    },
  };
}

export async function inspectBrandAssets(workspacePath, brandManifest) {
  const assets = brandManifest?.assets;
  if (!assets || typeof assets !== "object" || Array.isArray(assets)) {
    return {
      passed: false,
      missing: ["brand manifest"],
      mismatched: [],
      assets: assets ?? {},
    };
  }

  const missing = [];
  const mismatched = [];
  for (const [relativeName, expectedHash] of Object.entries(assets)) {
    const normalizedName = normalize(relativeName);
    if (
      isAbsolute(relativeName) ||
      normalizedName === ".." ||
      normalizedName.startsWith(`..${sep}`)
    ) {
      mismatched.push(relativeName);
      continue;
    }
    const assetPath = join(
      workspacePath,
      "public",
      "dev10x",
      normalizedName,
    );
    let content;
    try {
      content = await readFile(assetPath);
    } catch {
      missing.push(relativeName);
      continue;
    }
    const observedHash = createHash("sha256").update(content).digest("hex");
    if (observedHash !== expectedHash) mismatched.push(relativeName);
  }

  missing.sort();
  mismatched.sort();
  return {
    passed: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
    assets,
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

export async function executeValidation(command, args, cwd, timeout) {
  return executeProcess(command, args, { cwd, timeout });
}

export function validationPort(index) {
  if (!Number.isInteger(index) || index < 0 || index > 99) {
    throw new Error(`invalid validation index: ${index}`);
  }
  return 24_000 + index;
}

async function validateWorkspace(workspacePath, index) {
  const steps = [];
  const commands = [
    [
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      8 * 60 * 1000,
    ],
    ["npm", ["run", "build"], 5 * 60 * 1000],
    ["npm", ["run", "test:e2e"], 10 * 60 * 1000],
  ];

  const port = validationPort(index);
  const env = sanitizedChildEnv(process.env, {
    PLAYWRIGHT_PORT: String(port),
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${port}`,
  });

  for (const [command, args, timeout] of commands) {
    const result = await executeProcess(command, args, {
      cwd: workspacePath,
      env,
      timeout,
    });
    steps.push(result);
    if (result.status !== "passed") break;
  }
  return steps;
}

export function renderComparison({ prompt_sha256: promptHash, rows }) {
  const lines = [
    "# Comparação de agentes — landing page Dev10x",
    "",
    `Prompt SHA-256: \`${promptHash}\``,
    "",
    "| Célula | Matriz | Caminho | Provedor | Solicitado | Resolvido | Execução | Contrato | Marca | Validação | Duração observada | Observação |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |",
  ];

  for (const row of rows) {
    const validationStatus =
      row.validation?.length > 0 &&
      row.validation.every((step) => step.status === "passed")
        ? "passed"
        : (row.validation?.at(-1)?.status ?? "not-run");
    const e2eOutput =
      row.validation?.find((step) => step.command.includes("test:e2e"))
        ?.output ?? "";
    const e2eCount = [...e2eOutput.matchAll(/(\d+) passed\b/g)].at(-1)?.[1];
    const validation = e2eCount
      ? `${validationStatus} (${e2eCount} E2E)`
      : validationStatus;
    const observation = row.stale_process_recovered
      ? "processo obsoleto recuperado"
      : row.error
        ? String(row.error).split("\n")[0]
        : "—";
    const brand = row.brand?.passed
      ? "passed"
      : [
          ...(row.brand?.missing?.length
            ? [`missing: ${row.brand.missing.join(", ")}`]
            : []),
          ...(row.brand?.mismatched?.length
            ? [`mismatched: ${row.brand.mismatched.join(", ")}`]
            : []),
        ].join("; ") || "failed";
    lines.push(
      `| ${row.id} | ${row.matrix ?? "n/a"} | ${row.path} | ${row.provider} | ${modelEffort(row.requested_model, row.requested_effort)} | ${modelEffort(row.identity?.resolved_model, row.identity?.resolved_effort)} | ${row.status} | ${row.contract_passed ? "passed" : "failed"} | ${brand} | ${validation} | ${formatDuration(row.execution_observed_duration_ms ?? row.duration_ms)} | ${observation} |`,
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
      `- Artefatos do fluxo: \`${row.artifacts_root ?? row.artifact_root ?? "indisponível"}\``,
      `- Tentativas: ${row.attempts?.count ?? 0} (canônica: ${row.attempts?.canonical_attempt_id ?? "n/a"})`,
      `- Preview: ${row.preview?.servers?.[0]?.url ?? "indisponível"}`,
      `- Identidade: ${row.identity ? `thread=${row.identity.assistant_thread_id ?? "n/a"}, agent=${row.identity.agent_kind ?? "n/a"}, status=${row.identity.status ?? "n/a"}, source=${row.identity.source ?? "n/a"}` : "indisponível"}`,
      `- Modelo solicitado: ${modelEffort(row.requested_model, row.requested_effort)}`,
      `- Modelo resolvido: ${modelEffort(row.identity?.resolved_model, row.identity?.resolved_effort)}`,
      `- Git: ${row.git?.available ? `${row.git.changed_files} arquivos / ${row.git.changed_lines} linhas alteradas` : (row.git?.reason ?? "indisponível")}`,
      `- Evidências: ${row.artifacts ? `${row.artifacts.screenshots.length} screenshots, ${row.artifacts.videos.length} vídeos, ${row.artifacts.traces.length} traces` : "indisponível"}`,
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

function modelEffort(model, effort) {
  if (!model) return "n/a";
  return effort ? `${model} (${effort})` : model;
}

export function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "n/a";
  const totalSeconds = Math.round(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [
    ...(hours ? [`${hours}h`] : []),
    ...(hours || minutes ? [`${minutes}m`] : []),
    `${seconds}s`,
  ].join(" ");
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
  const manifest = JSON.parse(
    await readFile(join(runtimeRoot, "runs.json"), "utf8"),
  );
  const rows = [];

  for (const [index, run] of manifest.runs.entries()) {
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
    const attemptResults = await readAttemptResults(runtimeRoot, run.id);
    const attempts = summarizeAttempts(
      attemptResults,
      runResult.attempt_id ?? null,
    );

    const brand = facts.exists
      ? await inspectBrandAssets(workspacePath, manifest.brand)
      : {
          passed: false,
          missing: ["workspace"],
          mismatched: [],
          assets: manifest.brand?.assets ?? {},
        };
    const contractIsValid = facts.exists &&
      contractPassed(facts.contract) &&
      brand.passed;
    const validation =
      contractIsValid
        ? await validateWorkspace(workspacePath, index)
        : [];
    const git = facts.exists
      ? await gitFacts(workspacePath)
      : {
          available: false,
          reason: "workspace is missing",
          changed_lines: null,
        };
    const artifacts = await inventoryArtifacts([
      {
        source: "tracker",
        root: runResult.artifact_root,
      },
      {
        source: "generated_e2e",
        root: join(workspacePath, "test-results"),
      },
    ]);
    const row = {
      ...run,
      ...runResult,
      workspace_path: workspacePath,
      artifacts_root: runResult.artifact_root ?? null,
      attempts,
      duration_ms: runResult.duration_ms ?? null,
      execution_observed_duration_ms: observedExecutionDuration(runResult),
      identity: resolveRunIdentity(run, runResult),
      file_count: facts.file_count,
      contract: facts.contract,
      brand,
      contract_passed: contractIsValid,
      validation,
      git,
      artifacts,
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
        `${JSON.stringify(
          {
            prompt_sha256: comparison.prompt_sha256,
            rows: comparison.rows.map((row) => ({
              id: row.id,
              status: row.status,
              contract_passed: row.contract_passed,
              validation: row.validation.map((step) => step.status),
            })),
          },
          null,
          2,
        )}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
