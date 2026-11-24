import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker/index'

afterEach(() => vi.unstubAllGlobals())

describe('online Worker boundaries', () => {
  const env = { ASSETS: { fetch: vi.fn(async () => new Response('app')) } }

  it('serves current and legacy links and returns 404 for malformed game and account routes', async () => {
    const ASSETS = { fetch: async () => new Response('app', { headers: { 'Content-Type': 'text/html' } }) }
    for (const [path, status] of [
      ['/play/cdi/dcss-0.34', 200], ['/play/cdi/Ada/dcss-0.34', 200],
      ['/play/cdi', 404], ['/play/cdi/Ada/dcss-0.34/extra', 404], ['/watch/cdi/Ada/extra', 404],
      ['/accounts/rc/cdi/dcss-0.34', 200], ['/accounts/rc/cdi', 404], ['/accounts/morgues/cdi/not-a-timestamp', 404],
    ] as const) {
      expect((await worker.fetch(new Request('https://client.example' + path), { ASSETS })).status, path).toBe(status)
    }
  })

  it('keeps preview pages out of search while production pages stay indexable', async () => {
    const ASSETS = { fetch: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }) }
    const request = new Request('https://client.example/')
    expect((await worker.fetch(request, { ASSETS, PREVIEW: true })).headers.get('X-Robots-Tag')).toBe('noindex')
    expect((await worker.fetch(request, { ASSETS })).headers.get('X-Robots-Tag')).toBeNull()
  })

  it('rejects an unlisted destination before looking in the edge cache', async () => {
    const match = vi.fn(async () => new Response('stale unsafe entry'))
    vi.stubGlobal('caches', { default: { match } })
    const res = await worker.fetch(new Request('https://client.example/gamedata-proxy/evil.example/gamedata/abc/enums.js'), env)
    expect(res.status).toBe(404)
    expect(match).not.toHaveBeenCalled()
  })

  it('drops query strings from validated immutable asset cache keys', async () => {
    const match = vi.fn(async () => new Response('cached enums'))
    vi.stubGlobal('caches', { default: { match } })
    const path = '/gamedata-proxy/crawl.dcss.io/gamedata/abc/enums.js'
    const res = await worker.fetch(new Request('https://client.example' + path + '?random=123'), env)
    expect(await res.text()).toBe('cached enums')
    expect((match.mock.calls[0] as unknown as [Request])[0].url).toBe('https://client.example' + path)
  })

  it('serves bundled engines and rejects a missing engine file that fell through to the SPA', async () => {
    const request = new Request('https://client.example/engine/stable/engine.json')
    const manifest = await worker.fetch(request, { ASSETS: { fetch: async () => Response.json({ channel: 'stable' }) } })
    expect(manifest.headers.get('cache-control')).toBe('no-cache')
    expect(await manifest.json()).toEqual({ channel: 'stable' })
    const missing = await worker.fetch(request, { ASSETS: { fetch: async () => new Response('app', { headers: { 'Content-Type': 'text/html' } }) } })
    expect(missing.status).toBe(404)
  })

  it('never serves retired menu engine artifacts, even if an asset host retains them', async () => {
    const fetch = vi.fn(async () => new Response('stale engine'))
    for (const path of ['/menu-engine/manifest.json', '/menu-engine/builds/old/crawl.wasm', '/menu-engine/saves/Player.cs']) {
      expect((await worker.fetch(new Request('https://client.example' + path), { ASSETS: { fetch } })).status).toBe(404)
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})
