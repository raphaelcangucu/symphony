import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function waitForFile(path, timeoutMs = 3_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function waitForExit(child, timeoutMs = 3_000) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(
      () => reject(new Error("parent did not exit after signal")),
      timeoutMs,
    );
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolvePromise(exitCode);
    });
  });
}

test("executeProcess forwards parent termination to its detached process group", async () => {
  const root = await mkdtemp(join(tmpdir(), "symphony-process-signal-"));
  const grandchildPidPath = join(root, "grandchild.pid");
  const processModule = pathToFileURL(resolve("src/process.mjs")).href;
  const driverPath = join(root, "driver.mjs");
  await writeFile(
    driverPath,
    `
      import { executeProcess } from ${JSON.stringify(processModule)};
      await executeProcess(
        process.execPath,
        [
          "-e",
          ${JSON.stringify(`
            const { writeFileSync } = require("node:fs");
            writeFileSync(process.env.GRANDCHILD_PID_PATH, String(process.pid));
            process.on("SIGTERM", () => {});
            setInterval(() => {}, 30_000);
          `)},
        ],
        {
          cwd: process.cwd(),
          env: process.env,
          timeout: 30_000,
        },
      );
    `,
  );

  const driver = spawn(process.execPath, [driverPath], {
    cwd: process.cwd(),
    env: { ...process.env, GRANDCHILD_PID_PATH: grandchildPidPath },
    stdio: "ignore",
  });
  const grandchildPid = Number(await waitForFile(grandchildPidPath));
  driver.kill("SIGTERM");
  await waitForExit(driver);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));

  assert.throws(() => process.kill(grandchildPid, 0), /ESRCH/);
});
