/** Only the engine worker compiles Wasm. Its entry module is served under /offline-worker/. */
export const ENGINE_WORKER_POLICY = "default-src 'none'; connect-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'"
