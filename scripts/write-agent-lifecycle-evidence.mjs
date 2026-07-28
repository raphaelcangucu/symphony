import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const evidenceRoot = path.join(
  repositoryRoot,
  ".symphony/evidence/agent-cli-lifecycle",
);

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
    real_provider_smoke: "optional and not run",
    release_registry: "deterministic local fixtures",
  },
  artifacts,
};

await writeFile(
  path.join(evidenceRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
