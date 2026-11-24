import { ENGINE_WORKER_POLICY } from './worker/engine-policy'
import type { Plugin } from 'vite'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'

/**
 * Serves the offline engine as built locally (engine/build.sh writes
 * engine/dist) at /engine/, for dev and preview. A missing file is a 404, not
 * the app's index.html, so a channel that was never built reads as absent
 * (@orbrun/offline `loadChannels`).
 */
const ROOT = join(import.meta.dirname, '../../engine/dist')
const PREFIX = '/engine/'

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
}

export function engineFiles(): Plugin {
  const serve = (root: string, url: string | undefined, res: import('node:http').ServerResponse, next: () => void) => {
    const path = url?.split('?')[0]
    if (!path?.startsWith(PREFIX)) return next()
    const file = normalize(join(root, decodeURIComponent(path.slice(PREFIX.length))))
    let size = -1
    try {
      if (file.startsWith(root + sep)) {
        const st = statSync(file)
        if (st.isFile()) size = st.size
      }
    } catch {
      /* missing */
    }
    if (size < 0) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
    res.setHeader('Content-Length', size)
    res.setHeader('Cache-Control', 'no-cache')
    createReadStream(file).pipe(res)
  }
  return {
    name: 'orbrun-engine-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => serve(ROOT, req.url, res, next))
    },
    configurePreviewServer(server) {
      const documentPolicy = /^  Content-Security-Policy: (.+)$/m.exec(readFileSync(join(import.meta.dirname, 'public/_headers'), 'utf8'))![1]
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        if (path.startsWith('/offline-worker/')) res.setHeader('Content-Security-Policy', ENGINE_WORKER_POLICY)
        else res.setHeader('Content-Security-Policy', documentPolicy)
        serve(join(import.meta.dirname, 'dist/engine'), req.url, res, next)
      })
    },
  }
}
