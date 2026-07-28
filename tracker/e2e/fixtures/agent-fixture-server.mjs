import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import http from "node:http";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.SYMPHONY_AGENT_FIXTURE_PORT ?? "4218", 10);
const logFile = process.env.SYMPHONY_AGENT_FIXTURE_LOG;
const template = await readFile(new URL("./fake-agent-cli.sh", import.meta.url), "utf8");
const supported = new Set(["claude", "codex", "cursor", "opencode"]);
const state = { version: "1.0.0", mode: "ok" };

function script(agent, version, mode = "ok") {
  return template
    .replaceAll("__AGENT__", agent)
    .replaceAll("__VERSION__", version)
    .replaceAll("__MODE__", mode);
}

async function log(method, pathname, status) {
  if (!logFile) return;
  await appendFile(logFile, `${new Date().toISOString()} ${method} ${pathname} ${status}\n`);
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  let status = 404;

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      status = 200;
      response.writeHead(status, { "content-type": "application/json" });
      response.end('{"ok":true}');
    } else if (request.method === "POST" && url.pathname === "/control") {
      const input = JSON.parse((await body(request)) || "{}");
      if (typeof input.version === "string") state.version = input.version;
      if (typeof input.mode === "string") state.mode = input.mode;
      status = 200;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(state));
    } else {
      const manifest = url.pathname.match(/^\/manifest\/([^/]+)$/);
      const binary = url.pathname.match(/^\/binary\/([^/]+)\/([^/]+)$/);

      if (request.method === "GET" && manifest && supported.has(manifest[1])) {
        const agent = manifest[1];
        const contents = script(agent, state.version, state.mode);
        const checksum = createHash("sha256").update(contents).digest("hex");
        status = 200;
        response.writeHead(status, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            version: state.version,
            url: `http://${host}:${port}/binary/${agent}/${state.version}`,
            checksum: state.mode === "checksum_mismatch" ? "0".repeat(64) : checksum,
          }),
        );
      } else if (request.method === "GET" && binary && supported.has(binary[1])) {
        status = 200;
        response.writeHead(status, { "content-type": "application/octet-stream" });
        response.end(script(binary[1], binary[2], state.mode));
      } else {
        response.writeHead(status, { "content-type": "application/json" });
        response.end('{"error":"not_found"}');
      }
    }
  } catch {
    status = 500;
    response.writeHead(status, { "content-type": "application/json" });
    response.end('{"error":"fixture_failure"}');
  } finally {
    await log(request.method ?? "GET", url.pathname, status);
  }
});

server.listen(port, host);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
