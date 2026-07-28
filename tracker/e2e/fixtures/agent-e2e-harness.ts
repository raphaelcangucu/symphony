import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const trackerRoot = path.resolve(import.meta.dirname, "../..");
const repositoryRoot = path.resolve(trackerRoot, "..");
const elixirRoot = path.join(repositoryRoot, "elixir");
const fixtureRoot = path.join(trackerRoot, "e2e/fixtures");
const artifactRoot = path.join(trackerRoot, "test-results/agent-lifecycle-artifacts");
const serverPort = Number.parseInt(process.env.SYMPHONY_AGENT_E2E_PORT ?? "4217", 10);
const fixturePort = Number.parseInt(process.env.SYMPHONY_AGENT_FIXTURE_PORT ?? "4218", 10);
const token = "agent-e2e-token";
const sentinel = "agent-e2e-secret-must-never-leak";

interface ProtectedEntry {
  path: string;
  digest: string | null;
}

function protectedPaths(home: string): string[] {
  return [
    path.join(home, ".codex/auth.json"),
    path.join(home, ".codex/config.toml"),
    path.join(home, ".claude/.credentials.json"),
    path.join(home, ".cursor/auth.json"),
    path.join(home, ".config/opencode/auth.json"),
  ];
}

async function protectedManifest(home: string): Promise<ProtectedEntry[]> {
  return Promise.all(
    protectedPaths(home).map(async (file) => {
      try {
        const contents = await readFile(file);
        return {
          path: path.relative(home, file),
          digest: createHash("sha256").update(contents).digest("hex"),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { path: path.relative(home, file), digest: null };
        }
        throw error;
      }
    }),
  );
}

function cleanEnvironment(root: string, pathBin: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };

  for (const key of Object.keys(environment)) {
    if (/^(CODEX|CLAUDE|CURSOR|OPENCODE|ANTHROPIC|OPENAI)(_|$)/i.test(key)) {
      delete environment[key];
    }
  }

  return {
    ...environment,
    HOME: path.join(root, "home"),
    XDG_CONFIG_HOME: path.join(root, "home/.config"),
    XDG_DATA_HOME: path.join(root, "xdg-data"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    PATH: `${pathBin}${path.delimiter}${process.env.PATH ?? ""}`,
    SYMPHONY_AGENT_E2E_ROOT: root,
    SYMPHONY_AGENT_E2E_FIXTURE_URL: `http://127.0.0.1:${fixturePort}`,
    SYMPHONY_AGENT_FIXTURE_PORT: String(fixturePort),
    SYMPHONY_AGENT_FIXTURE_LOG: path.join(root, "logs/fixture.log"),
    SYMPHONY_LOCAL_TRACKER_DATABASE: path.join(root, "tracker.sqlite3"),
    SYMPHONY_TRACKER_HOST: "127.0.0.1",
    SYMPHONY_TRACKER_PORT: String(serverPort),
    SYMPHONY_TRACKER_TOKEN: token,
    SYMPHONY_OBSERVABILITY_ENABLED: "false",
    MIX_ENV: "dev",
  };
}

async function createPathFixtures(pathBin: string) {
  const template = await readFile(path.join(fixtureRoot, "fake-agent-cli.sh"), "utf8");
  const executables = {
    claude: "claude",
    codex: "codex",
    cursor: "cursor-agent",
    opencode: "opencode",
  };

  await mkdir(pathBin, { recursive: true });

  for (const [agent, executable] of Object.entries(executables)) {
    const target = path.join(pathBin, executable);
    const contents = template
      .replaceAll("__AGENT__", agent)
      .replaceAll("__VERSION__", "path-0.9.0")
      .replaceAll("__MODE__", "ok");
    await writeFile(target, contents);
    await chmod(target, 0o755);
  }
}

async function waitFor(url: string, process: ChildProcess, label: string) {
  const deadline = Date.now() + 45_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (process.exitCode != null) {
      throw new Error(`${label} exited before becoming ready (code ${process.exitCode})`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`${label} did not become ready: ${String(lastError)}`);
}

async function stop(child: ChildProcess) {
  if (child.exitCode != null || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3_000),
    ),
  ]);
}

async function filesystemManifest(root: string) {
  const entries: Array<{ path: string; type: string; size?: number; mode?: string }> = [];

  async function visit(directory: string) {
    for (const name of await readdir(directory)) {
      const absolute = path.join(directory, name);
      const metadata = await stat(absolute);
      const relative = path.relative(root, absolute);

      if (metadata.isDirectory()) {
        entries.push({ path: relative, type: "directory" });
        await visit(absolute);
      } else {
        entries.push({
          path: relative,
          type: "file",
          size: metadata.size,
          mode: `0${(metadata.mode & 0o777).toString(8)}`,
        });
      }
    }
  }

  await visit(root);
  return entries;
}

async function assertNoSentinel(directory: string) {
  for (const name of await readdir(directory)) {
    const file = path.join(directory, name);
    const metadata = await stat(file);
    if (metadata.isDirectory()) {
      await assertNoSentinel(file);
      continue;
    }

    const contents = await readFile(file);
    if (contents.includes(Buffer.from(sentinel))) {
      throw new Error(`secret sentinel leaked into ${file}`);
    }
  }
}

export default async function globalSetup() {
  const realHome = os.homedir();
  const root = await mkdtemp(path.join(os.tmpdir(), "symphony-agent-e2e-"));
  const disposableHome = path.join(root, "home");

  if (path.resolve(disposableHome) === path.resolve(realHome)) {
    throw new Error("agent E2E refused to use the operator's real HOME");
  }

  await Promise.all([
    mkdir(disposableHome, { recursive: true }),
    mkdir(path.join(root, "logs"), { recursive: true }),
  ]);

  const before = await protectedManifest(realHome);
  const pathBin = path.join(root, "path-bin");
  await createPathFixtures(pathBin);
  const environment = cleanEnvironment(root, pathBin);

  process.env.SYMPHONY_AGENT_E2E_ROOT = root;
  process.env.SYMPHONY_AGENT_E2E_DATA_ROOT = path.join(root, "data");
  process.env.SYMPHONY_AGENT_E2E_FIXTURE_URL = environment.SYMPHONY_AGENT_E2E_FIXTURE_URL;

  const fixtureOutput = await writeFile(path.join(root, "logs/fixture-process.log"), "");
  void fixtureOutput;
  const fixtureLog = await import("node:fs").then(({ createWriteStream }) =>
    createWriteStream(path.join(root, "logs/fixture-process.log"), { flags: "a" }),
  );
  const phoenixLog = await import("node:fs").then(({ createWriteStream }) =>
    createWriteStream(path.join(root, "logs/phoenix-process.log"), { flags: "a" }),
  );

  const fixture = spawn(process.execPath, [path.join(fixtureRoot, "agent-fixture-server.mjs")], {
    cwd: trackerRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  fixture.stdout?.pipe(fixtureLog);
  fixture.stderr?.pipe(fixtureLog);
  await waitFor(`http://127.0.0.1:${fixturePort}/health`, fixture, "fixture registry");

  const prepare = spawnSync(
    "mix",
    ["run", "--no-start", path.join(fixtureRoot, "prepare-agent-e2e.exs")],
    { cwd: elixirRoot, env: environment, encoding: "utf8" },
  );

  if (prepare.status !== 0) {
    await stop(fixture);
    throw new Error(`database preparation failed:\n${prepare.stdout}\n${prepare.stderr}`);
  }

  const phoenix = spawn(
    "mix",
    ["run", "--no-start", path.join(fixtureRoot, "start-agent-e2e.exs")],
    {
      cwd: elixirRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  phoenix.stdout?.pipe(phoenixLog);
  phoenix.stderr?.pipe(phoenixLog);

  try {
    await waitFor(`http://127.0.0.1:${serverPort}/tracker`, phoenix, "Phoenix tracker");
  } catch (error) {
    await Promise.all([stop(phoenix), stop(fixture)]);
    throw error;
  }

  return async () => {
    await Promise.all([stop(phoenix), stop(fixture)]);
    fixtureLog.end();
    phoenixLog.end();

    const after = await protectedManifest(realHome);
    await rm(artifactRoot, { recursive: true, force: true });
    await mkdir(artifactRoot, { recursive: true });
    await cp(path.join(root, "logs"), path.join(artifactRoot, "logs"), { recursive: true });
    await writeFile(
      path.join(artifactRoot, "protected-home.json"),
      JSON.stringify({ unchanged: JSON.stringify(before) === JSON.stringify(after), before, after }, null, 2),
    );
    await writeFile(
      path.join(artifactRoot, "filesystem-manifest.json"),
      JSON.stringify(await filesystemManifest(root), null, 2),
    );

    await assertNoSentinel(artifactRoot);

    await rm(root, { recursive: true, force: true });

    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error("agent E2E changed a protected provider file in the operator's real HOME");
    }
  };
}
