import assert from "node:assert/strict";
import test from "node:test";

import { sanitizedChildEnv } from "../seed/scripts/child-env.mjs";

test("generated code receives only the explicit safe environment allowlist", () => {
  const childEnv = sanitizedChildEnv(
    {
      PATH: "/usr/bin",
      HOME: "/tmp/benchmark-home",
      LANG: "pt_BR.UTF-8",
      SYMPHONY_BENCH_TOKEN: "tracker-secret",
      OPENAI_API_KEY: "openai-secret",
      ANTHROPIC_API_KEY: "anthropic-secret",
      CURSOR_API_KEY: "cursor-secret",
      GITHUB_TOKEN: "github-secret",
      npm_config_registry: "https://registry.example.test",
    },
    {
      PLAYWRIGHT_PORT: "24100",
      PLAYWRIGHT_BASE_URL: "http://127.0.0.1:24100",
    },
  );

  assert.deepEqual(childEnv, {
    PATH: "/usr/bin",
    HOME: "/tmp/benchmark-home",
    LANG: "pt_BR.UTF-8",
    PLAYWRIGHT_PORT: "24100",
    PLAYWRIGHT_BASE_URL: "http://127.0.0.1:24100",
  });
  assert.equal(
    Object.keys(childEnv).some((name) => /TOKEN|SECRET|API_KEY/i.test(name)),
    false,
  );
});

test("undefined allowlisted values are omitted", () => {
  assert.deepEqual(
    sanitizedChildEnv({ PATH: "/bin", HOME: undefined, CI: undefined }),
    { PATH: "/bin" },
  );
});
