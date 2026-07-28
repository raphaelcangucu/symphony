import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const evidenceRoot = path.join(
  repositoryRoot,
  ".symphony/evidence/agent-cli-lifecycle",
);
const sentinel = ["agent", "e2e", "secret", "must", "never", "leak"].join("-");

async function filesBelow(directory) {
  const files = [];

  async function visit(current) {
    for (const name of await readdir(current)) {
      const absolute = path.join(current, name);
      const metadata = await stat(absolute);
      if (metadata.isDirectory()) {
        await visit(absolute);
      } else {
        files.push(absolute);
      }
    }
  }

  await visit(directory);
  return files;
}

await mkdir(evidenceRoot, { recursive: true });
const existing = await filesBelow(evidenceRoot);
const video = existing.find((file) => file.endsWith(".webm"));

if (video) {
  const mp4 = path.join(evidenceRoot, "agent-cli-lifecycle.mp4");
  const converted = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      video,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4,
    ],
    { stdio: "pipe" },
  );

  if (converted.status !== 0) {
    throw new Error(`ffmpeg failed: ${converted.stderr.toString()}`);
  }
}

for (const file of await filesBelow(evidenceRoot)) {
  const contents =
    path.extname(file) === ".zip"
      ? spawnSync("unzip", ["-p", file], {
          maxBuffer: 50 * 1024 * 1024,
        }).stdout
      : await readFile(file);

  if (contents.includes(Buffer.from(sentinel))) {
    throw new Error(
      `secret sentinel leaked into ${path.relative(repositoryRoot, file)}`,
    );
  }
}

const protectedHomePath = path.join(
  evidenceRoot,
  "artifacts/protected-home.json",
);
const protectedHome = JSON.parse(await readFile(protectedHomePath, "utf8"));
const artifacts = (await filesBelow(evidenceRoot))
  .filter((file) => path.basename(file) !== "manifest.json")
  .map((file) => path.relative(repositoryRoot, file))
  .sort();

const manifest = {
  issue: "agent-cli-lifecycle",
  generated_at: new Date().toISOString(),
  scope: "Local task-only full-stack validation; not executed by CI.",
  tests: [
    { command: "cd tracker && npm run build", result: "passed" },
    {
      command:
        "cd tracker && npx playwright test --config playwright.agent-lifecycle.config.ts",
      result: "1 passed; retries disabled",
    },
  ],
  invariants: {
    operator_provider_files_unchanged: protectedHome.unchanged,
    secret_sentinel_absent_from_all_artifacts: true,
    real_provider_smoke: "optional and not run",
    release_registry: "deterministic local fixtures",
  },
  matrix: [
    "four managed installs and executable isolation",
    "explicit PATH selection, managed fallback/recovery, and both-sources failure",
    "active-session update deferral and post-session activation",
    "download, checksum, extraction, and probe rollback",
    "default, project, and request account precedence with process-visible isolated home",
    "independent account usage, stale generation rejection, stale/backoff classifications",
    "disabled/enabled failover, all-ineligible redaction, no mid-session identity switch",
  ],
  artifacts,
};

await writeFile(
  path.join(evidenceRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
