import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const script = readFileSync(new URL('../public/umami.js', import.meta.url), 'utf8')
const website = '94db1cb1-74f4-4a40-ad6c-962362670409'

function openPage(href: string, navigator = {}) {
  const location = new URL(href)
  const window = new EventTarget()
  const fetch = vi.fn().mockResolvedValue({})
  const document = {
    currentScript: { dataset: { websiteId: website, publicPages: '/,/about,/about/steam' } },
    title: 'PrivatePlayer the Chiller',
    referrer: 'https://example.com/PrivatePlayer',
  }
  runInNewContext(script, { document, fetch, location, navigator, window })
  return {
    fetch,
    publish: (detail: unknown) => window.dispatchEvent(new CustomEvent('polished-crawl:analytics', { detail })),
    payloads: () => fetch.mock.calls.map(([, init]) => JSON.parse(init.body).payload),
  }
}

describe('Umami browser requests', () => {
  it('collects only a fixed page label and allowlisted action names on legacy player URLs', () => {
    const page = openPage('https://polished-crawl.com/play/cdi/PrivatePlayer/dcss-0.34?token=private#PrivatePlayer')
    page.publish('play_clicked')
    page.publish('login_succeeded')
    page.publish('game_started')
    page.publish('PrivatePlayer')
    page.publish({ name: 'play_clicked', username: 'PrivatePlayer' })
    const base = { website, hostname: 'polished-crawl.com', url: '/play' }
    expect(page.payloads()).toEqual([base, ...['play_clicked', 'login_succeeded', 'game_started'].map(name => ({ ...base, name }))])
    expect(page.fetch).toHaveBeenCalledWith('https://gateway.umami.is/api/send', expect.objectContaining({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
    }))
  })

  it('keeps fixed public page addresses and drops arbitrary paths', () => {
    expect(openPage('https://polished-crawl.com/about/steam?q=private').payloads()[0].url).toBe('/about/steam')
    expect(openPage('https://polished-crawl.com/PrivatePlayer').payloads()[0].url).toBe('/other')
  })

  it('skips previews and respects browser privacy signals', () => {
    expect(openPage('https://dcss-client.vittis.workers.dev/').fetch).not.toHaveBeenCalled()
    const page = openPage('https://polished-crawl.com/', { globalPrivacyControl: true })
    page.publish('login_succeeded')
    expect(page.fetch).not.toHaveBeenCalled()
    expect(openPage('https://polished-crawl.com/', { doNotTrack: '1' }).fetch).not.toHaveBeenCalled()
  })
})
