import { spawn } from "node:child_process";

const DEFAULT_MAX_OUTPUT = 20_000;

function terminateProcessGroup(child, signal = "SIGTERM") {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

export async function executeProcess(
  command,
  args,
  {
    cwd,
    env = process.env,
    timeout,
    maxOutput = DEFAULT_MAX_OUTPUT,
    onStdout,
    onStderr,
  },
) {
  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    let settled = false;
    let terminating = false;
    const signalHandlers = new Map();

    const appendOutput = (chunk, listener) => {
      const text = chunk.toString();
      output = `${output}${text}`.slice(-maxOutput);
      listener?.(text);
    };
    child.stdout.on("data", (chunk) => appendOutput(chunk, onStdout));
    child.stderr.on("data", (chunk) => appendOutput(chunk, onStderr));

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessGroup(child);
      setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 1_000).unref();
    }, timeout);

    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => {
        if (terminating) return;
        terminating = true;
        terminateProcessGroup(child);
        setTimeout(() => {
          terminateProcessGroup(child, "SIGKILL");
          for (const [registeredSignal, registeredHandler] of signalHandlers) {
            process.removeListener(registeredSignal, registeredHandler);
          }
          process.kill(process.pid, signal);
        }, 250);
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }

    const finish = (exitCode, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      terminateProcessGroup(child);
      if (!terminating) {
        for (const [signal, handler] of signalHandlers) {
          process.removeListener(signal, handler);
        }
      }
      resolvePromise({
        command: [command, ...args].join(" "),
        status: timedOut ? "timed_out" : exitCode === 0 ? "passed" : "failed",
        exit_code: Number.isInteger(exitCode) ? exitCode : null,
        duration_ms: Date.now() - startedAt,
        output,
        ...(error ? { error: error.message ?? String(error) } : {}),
      });
    };

    child.once("error", (error) => finish(null, error));
    child.once("exit", (exitCode) => {
      let openStreams = 2;
      const streamEnded = () => {
        openStreams -= 1;
        if (openStreams === 0) finish(exitCode);
      };
      child.stdout.once("end", streamEnded);
      child.stderr.once("end", streamEnded);
      setTimeout(() => finish(exitCode), 50);
    });
  });
}
