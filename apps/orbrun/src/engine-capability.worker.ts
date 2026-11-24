const wasm = WebAssembly as typeof WebAssembly & { Suspending?: unknown; promising?: unknown }
self.postMessage(typeof wasm.Suspending === 'function' && typeof wasm.promising === 'function' ? 'jspi' : 'asyncify')
