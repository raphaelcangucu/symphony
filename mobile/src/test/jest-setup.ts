// assistant-ui/tap keeps a Node MessagePort alive when MessageChannel is
// available. React Native does not use Node's worker_threads implementation,
// so keep Jest on the package's timer fallback as well.
Object.defineProperty(globalThis, "MessageChannel", {
  configurable: true,
  value: undefined,
  writable: true,
});
