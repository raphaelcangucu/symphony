export function createApi({ baseUrl, token, fetchImpl = globalThis.fetch }) {
  if (!baseUrl || !token || typeof fetchImpl !== "function") {
    throw new Error("baseUrl, token and fetch implementation are required");
  }

  const root = baseUrl.replace(/\/+$/, "");

  return {
    async request(path, { method = "GET", body } = {}) {
      const response = await fetchImpl(`${root}/api/tracker/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;

      if (!response.ok) {
        const message =
          payload?.error?.message ??
          payload?.message ??
          `${method} ${path} failed with HTTP ${response.status}`;
        throw new Error(message);
      }

      return payload?.data ?? payload;
    },
  };
}
