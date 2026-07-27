const ALLOWED_ENVIRONMENT_KEYS = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "CI",
  "TERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "PLAYWRIGHT_BROWSERS_PATH",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
]);

export function sanitizedChildEnv(source = process.env, overrides = {}) {
  const result = {};

  for (const key of ALLOWED_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (typeof value === "string") result[key] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "string") result[key] = value;
  }

  return result;
}
