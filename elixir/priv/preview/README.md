# Symphony preview runner

`run.sh` executes a normalized preview run spec while enforcing Symphony's
RuntimeContract and RuntimeReport lifecycle.

The runner requires these environment variables:

- `SYMPHONY_PREVIEW_CONTRACT_ID`
- `SYMPHONY_PREVIEW_CONTRACT_REVISION`
- `SYMPHONY_PREVIEW_PREFERRED_PORT`
- `SYMPHONY_PREVIEW_ALLOWED_PORTS` (comma-separated)
- `SYMPHONY_PREVIEW_REPORT_PATH`
- `SYMPHONY_PREVIEW_RUN_SPEC`
- `PORT`

`SYMPHONY_PREVIEW_SERVER_SLUG`, `SYMPHONY_PREVIEW_SESSION_NAME`, and
`SYMPHONY_WORKSPACE` are optional. `SYMPHONY_PREVIEW_WARMUP=1` enables a
start, probe, and stop warm-up cycle.

The JSON run spec supports:

```json
{
  "cwd": "frontend",
  "prepare": [
    {"argv": ["npm", "install"]}
  ],
  "start": [
    {"exists": "scripts/setup", "run": ["bash", "scripts/setup"]},
    ["npm", "run", "dev", "--", "--port", "4100"]
  ],
  "health": {
    "path": "/health",
    "host_header": "example.test",
    "timeout_ms": 120000,
    "interval_ms": 1000,
    "also": [
      {"exists": "graphql", "path": "/graphql/health"}
    ]
  },
  "stop": {
    "signal": "TERM",
    "grace_ms": 5000
  },
  "warmup": false
}
```

Commands are argv arrays and are always executed directly, never through a
shell. Legacy bare argv arrays, `{"argv": [...]}`, and exists-gated
`{"exists": "...", "run": [...]}` entries are accepted. Shell control
metacharacters are rejected.

The runner changes into the absolute `cwd`, or resolves a relative `cwd`
against `SYMPHONY_WORKSPACE` (the launch directory by default). It atomically
writes `starting`, then `ready` only after all enabled HTTP probes succeed and
`PORT` is present in the allowed-port lease. Failures produce `error`. Signals
stop the supervised process group using the configured stop policy and produce
`stopped`.
