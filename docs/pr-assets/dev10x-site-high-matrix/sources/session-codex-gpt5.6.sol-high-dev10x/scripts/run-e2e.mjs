import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sanitizedChildEnv } from "./child-env.mjs";

export function e2ePort(env = process.env) {
  const raw = env.PLAYWRIGHT_PORT ?? "4173";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`invalid PLAYWRIGHT_PORT: ${raw}`);
  }
  return port;
}

function terminateProcessGroup(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function stopProcessGroup(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  terminateProcessGroup(child);
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    terminateProcessGroup(child, "SIGKILL");
  }
}

export async function waitForHttp(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "preview did not answer";

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `preview exited before it was ready (code=${child.exitCode ?? "none"}, signal=${child.signalCode ?? "none"})`,
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 750);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error?.message ?? String(error);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }

  throw new Error(`preview did not become ready at ${url}: ${lastError}`);
}

function runPlaywright(args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("npx", ["playwright", "test", ...args], {
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolvePromise(code ?? (signal ? 1 : 0));
    });
  });
}

export async function runE2e(args = process.argv.slice(2), env = process.env) {
  const port = e2ePort(env);
  const baseURL =
    env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
  const childEnv = sanitizedChildEnv(env, {
    PLAYWRIGHT_BASE_URL: baseURL,
    PLAYWRIGHT_PORT: String(port),
  });
  const preview = spawn(
    "npm",
    [
      "run",
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      detached: true,
      env: childEnv,
      stdio: "inherit",
    },
  );

  const forwardSignal = (signal) => {
    terminateProcessGroup(preview);
    process.exitCode = signal === "SIGINT" ? 130 : 143;
  };
  const onSigint = () => forwardSignal("SIGINT");
  const onSigterm = () => forwardSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    await waitForHttp(baseURL, preview);
    return await runPlaywright(args, childEnv);
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await stopProcessGroup(preview);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  runE2e()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
