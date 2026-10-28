// Renderer rules (SR-05, SR-08): no network, no Node, no Electron, no eval.
export const rendererRestrictions = {
  "no-restricted-globals": ["error", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "require", "process"],
  "no-restricted-imports": ["error", {
    patterns: ["electron", "node:*", "fs", "path", "child_process", "os", "net", "http", "https", "crypto"],
  }],
  "no-eval": "error",
  "no-implied-eval": "error",
};
