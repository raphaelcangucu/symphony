import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

import { e2ePort, waitForHttp } from "../seed/scripts/run-e2e.mjs";

test("seed E2E runner reserves a validated isolated preview port", () => {
  assert.equal(e2ePort({}), 4173);
  assert.equal(e2ePort({ PLAYWRIGHT_PORT: "24105" }), 24_105);
  assert.throws(
    () => e2ePort({ PLAYWRIGHT_PORT: "invalid" }),
    /invalid PLAYWRIGHT_PORT/,
  );
});

test("seed E2E runner times out a closed-port probe instead of hanging", async () => {
  const server = createServer();
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const { port } = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));

  const startedAt = Date.now();
  await assert.rejects(
    waitForHttp(
      `http://127.0.0.1:${port}/`,
      { exitCode: null, signalCode: null },
      250,
    ),
    /preview did not become ready/,
  );
  assert.ok(Date.now() - startedAt < 2_000);
});
